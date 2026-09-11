import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "../../auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getSignedDownloadUrl } from "@/lib/storage";
import { canTransition, type JobState } from "@/lib/jobState";
import { selectPrinterForShop, type SelectedPrinter } from "@/lib/printerSelection";

/**
 * An agent asking for its next print job.
 *
 * THE BUG THIS REPLACES
 * The route called an RPC, `claim_next_job`, that has never existed — it is
 * defined in no migration and no SQL file, so every call failed and every
 * request fell through to a "fallback" path that was really the only path.
 * That fallback selected the oldest QUEUED row in the entire table with no
 * shop filter, then checked afterwards whether the order happened to belong to
 * the calling shop and returned 204 if not. One shop's stuck job therefore
 * blocked every other shop's agent forever: the same row was picked and
 * rejected on every poll, and nothing behind it was ever considered. Three
 * paid orders sat unprinted behind another shop's job for two days.
 *
 * HOW IT WORKS NOW
 * One mechanism, not two. The RPC call is gone rather than being implemented
 * alongside this, so there is a single claim path to reason about.
 *
 *   1. Candidates are selected with the shop filter applied IN the query, via
 *      an inner join on orders. A job belonging to another shop is never a
 *      candidate, so it can neither be claimed nor block the queue.
 *   2. The download URL is signed BEFORE the claim. Signing after would mean a
 *      storage failure left the job CLAIMED with no way for the agent to fetch
 *      it — stranded in a state only a human can leave.
 *   3. The claim itself is a compare-and-swap: the UPDATE matches only rows
 *      still QUEUED and returns what it changed. Two agents racing for one job
 *      cannot both win, because Postgres takes a row lock for the UPDATE and
 *      the loser matches zero rows. This is why no SELECT ... FOR UPDATE SKIP
 *      LOCKED is needed, and why the missing RPC was never load-bearing.
 *   4. Losing the swap moves to the next candidate rather than giving up, so a
 *      contended queue still drains.
 *
 * ISOLATION
 * Shop scoping is applied three times over: in the candidate query, in a
 * re-check on the joined row before anything is written, and in the final
 * order update. The authenticated shop id comes from authenticateAgent, which
 * verifies the agent's hashed secret against its own shop — a request cannot
 * name a shop it has not authenticated as.
 *
 * WHICH PRINTER
 * The response carries the printer the shop owner chose in Dashboard →
 * Printers, by persisted id and exact Windows name. The agent used to decide
 * this for itself with win32print.GetDefaultPrinter(), so the owner's choice
 * had no effect on anything.
 *
 * The selection is resolved from this shop's rows only, and is checked BEFORE
 * a job is claimed: a shop with no usable printer keeps its jobs QUEUED and
 * gets 409 with a reason, rather than having a job claimed that could never be
 * printed. The chosen printer is also written to orders.printer_id, so the
 * attempt endpoint records what the server assigned instead of trusting what
 * the agent reports back.
 */

/**
 * How many queued jobs to consider per poll. More than one so a job another
 * agent claims in the same instant does not cost the caller a whole cycle;
 * small because a shop realistically runs one agent.
 */
const CANDIDATE_LIMIT = 5;

/** Long enough for the agent to download a large document, and no longer. */
const DOWNLOAD_URL_TTL_SECONDS = 600;

/** The shape of the joined row. Embedded to-one rows arrive as an object. */
interface CandidateJob {
  id: string;
  order_id: string;
  state: string;
  created_at: string;
  orders: {
    id: string;
    shop_id: string;
    payment_status: string;
    color_mode: string;
    paper_size: string;
    orientation: string;
    sides: string;
    copies: number;
    page_range: string;
    page_count: number | null;
  };
}

/**
 * Move a job that can never be delivered out of the queue and in front of a
 * human.
 *
 * HELD is the state machine's deliberate checkpoint: it stops the agent
 * picking the job up again while leaving the shop owner to decide what to do,
 * and the dashboard surfaces it under "Needs attention". The alternative —
 * skipping quietly on every poll — is how a paid order disappears: queued in
 * the database, invisible in practice, with the customer still waiting.
 *
 * Written as a compare-and-swap on QUEUED so this cannot disturb a job that
 * another agent legitimately claimed in the meantime.
 */
async function parkUndeliverable(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: { id: string; state: string },
  orderId: string,
  shopId: string,
  reason: string
): Promise<void> {
  console.error(`[agent-claim] shop=${shopId} holding job=${job.id}: ${reason}`);

  if (!canTransition(job.state as JobState, "HELD")) return;

  const { data: held } = await supabase
    .from("print_jobs")
    .update({ state: "HELD" })
    .eq("id", job.id)
    .eq("state", "QUEUED")
    .select("id");

  if (!held || held.length === 0) return;

  await supabase
    .from("orders")
    .update({ print_status: "held", failure_reason: reason })
    .eq("id", orderId)
    .eq("shop_id", shopId);
}

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return auth.response;

  const supabase = createServiceRoleClient();

  // Resolve the shop's chosen printer first. There is no point claiming a job
  // for a shop that has nowhere to print it, and claiming one would move it
  // out of QUEUED into a state only a human can leave.
  const { data: printerRows, error: printerError } = await supabase
    .from("printers")
    .select("id, shop_id, system_name, display_name, is_default, is_enabled, supports_color, supports_duplex, agent_id, last_status")
    .eq("shop_id", auth.shopId);

  if (printerError) {
    console.error(`[agent-claim] shop=${auth.shopId} printer query failed: ${printerError.message}`);
    return NextResponse.json({ error: "Could not look for work." }, { status: 500 });
  }

  const selection = selectPrinterForShop(printerRows ?? [], auth.shopId);

  // `orders!inner` makes this an inner join, so `orders.shop_id` filters the
  // job rows themselves. Only jobs whose order is this shop's AND paid for are
  // ever returned. Oldest first: a print queue is first come, first served.
  const { data, error } = await supabase
    .from("print_jobs")
    .select(
      "id, order_id, state, created_at, orders!inner(id, shop_id, payment_status, color_mode, paper_size, orientation, sides, copies, page_range, page_count)"
    )
    .eq("state", "QUEUED")
    .eq("orders.shop_id", auth.shopId)
    .eq("orders.payment_status", "paid")
    .order("created_at", { ascending: true })
    .limit(CANDIDATE_LIMIT);

  if (error) {
    console.error(`[agent-claim] shop=${auth.shopId} candidate query failed: ${error.message}`);
    return NextResponse.json({ error: "Could not look for work." }, { status: 500 });
  }

  // The embedded select is beyond what the generated types infer, so the shape
  // is declared once rather than asserted at each use.
  const candidates = (data ?? []) as unknown as CandidateJob[];

  // Nothing waiting: an unconfigured printer is not worth mentioning yet.
  if (candidates.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  // Work is waiting but there is nowhere to print it. Say so explicitly rather
  // than returning "nothing to do", which would leave the agent, the owner and
  // the customer all believing different things. The jobs stay QUEUED; the
  // dashboard already renders this as "Waiting — no printer" on the order.
  if (!selection.ok) {
    console.error(
      `[agent-claim] shop=${auth.shopId} has ${candidates.length} queued job(s) but no usable printer: ${selection.code}`
    );
    return NextResponse.json(
      { error: selection.message, code: selection.code, queuedJobs: candidates.length },
      { status: 409 }
    );
  }

  const printer: SelectedPrinter = selection.printer;

  for (const job of candidates) {
    const order = job.orders;

    // Defence in depth. The query already scoped this; if that ever stops
    // being true, refuse rather than hand one shop's document to another.
    if (!order || order.shop_id !== auth.shopId || order.payment_status !== "paid") {
      console.error(
        `[agent-claim] shop=${auth.shopId} refusing job=${job.id}: candidate query returned a row that is not this shop's paid order`
      );
      continue;
    }

    // The state machine owns what may follow the state this row is actually
    // in; this route does not get to invent a transition. Checked against the
    // row rather than the literal "QUEUED" so it stays a real assertion if the
    // candidate query is ever widened.
    if (!canTransition(job.state as JobState, "CLAIMED")) {
      console.error(
        `[agent-claim] shop=${auth.shopId} skipping job=${job.id}: ${job.state} cannot become CLAIMED`
      );
      continue;
    }

    const { data: file } = await supabase
      .from("order_files")
      .select("storage_path, converted_storage_path, original_filename, mime_type")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!file) {
      // An order with no file can never be printed. Park it for the owner
      // rather than leaving it QUEUED, where it would sit as "In queue"
      // forever while the agent silently skipped it on every poll.
      await parkUndeliverable(
        supabase,
        job,
        order.id,
        auth.shopId,
        "No document is attached to this order, so it can't be printed."
      );
      continue;
    }

    // Prefer the converted PDF when one exists — that is what actually prints.
    const storagePath = file.converted_storage_path || file.storage_path;

    let downloadUrl: string;
    try {
      downloadUrl = await getSignedDownloadUrl(storagePath, DOWNLOAD_URL_TTL_SECONDS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Two different problems. A document that is gone will never appear, so
      // the job is parked for the owner. Anything else — storage briefly
      // unreachable — is transient, so the job stays QUEUED and the next poll
      // retries it. Signing happens before the claim precisely so neither case
      // can strand a job in CLAIMED with nothing to download.
      if (/not.?found/i.test(message)) {
        await parkUndeliverable(
          supabase,
          job,
          order.id,
          auth.shopId,
          "The uploaded document is no longer in storage, so it can't be printed."
        );
      } else {
        console.error(
          `[agent-claim] shop=${auth.shopId} leaving job=${job.id} queued: could not sign ${storagePath}: ${message}`
        );
      }
      continue;
    }

    // Compare-and-swap. Only the caller that flips QUEUED -> CLAIMED proceeds;
    // a concurrent agent matches zero rows and moves on to the next candidate.
    const { data: swapped, error: swapError } = await supabase
      .from("print_jobs")
      .update({
        state: "CLAIMED",
        claimed_by_agent_id: auth.agentId,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("state", "QUEUED")
      .select("id");

    if (swapError) {
      console.error(`[agent-claim] shop=${auth.shopId} claim failed for job=${job.id}: ${swapError.message}`);
      continue;
    }

    if (!swapped || swapped.length === 0) {
      // Another agent got there first between the read and the write.
      continue;
    }

    // Mirror onto the order, scoped to the shop as well as the id, and record
    // which printer this job was assigned. orders.printer_id is what the
    // attempt endpoint reads, so the printer written against the attempt is
    // the one the server chose — not one the agent named.
    const { error: orderError } = await supabase
      .from("orders")
      .update({ print_status: "claimed", printer_id: printer.id })
      .eq("id", order.id)
      .eq("shop_id", auth.shopId);

    if (orderError) {
      // The claim stands — the agent is about to print it — but the dashboard
      // would show it as still queued, so this must not vanish silently.
      console.error(
        `[agent-claim] shop=${auth.shopId} claimed job=${job.id} but could not update order ${order.id}: ${orderError.message}`
      );
    }

    return NextResponse.json({
      jobId: job.id,
      orderId: order.id,
      downloadUrl,
      filename: file.original_filename ?? "document.pdf",
      mimeType: file.mime_type ?? "application/pdf",
      // The shop owner's choice, by id and by the exact Windows name. The
      // agent prints to this and to nothing else.
      printer,
      printSettings: {
        colorMode: order.color_mode,
        paperSize: order.paper_size,
        orientation: order.orientation,
        sides: order.sides,
        copies: order.copies,
        pageRange: order.page_range,
        pageCount: order.page_count,
      },
    });
  }

  // Nothing claimable for this shop right now.
  return new NextResponse(null, { status: 204 });
}
