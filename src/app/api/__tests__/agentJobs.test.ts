import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb, asClient } from "@/lib/__tests__/fakeSupabase";

/**
 * The agent's side of the pipeline, through the real route handlers, against
 * an in-memory database. Covers the guarantees that stop paper being wasted
 * or money being taken for nothing:
 *
 *   - a job is attempted at most once (no duplicate printing)
 *   - claim hands out only paid, QUEUED jobs — never one already attempted
 *   - a crashed agent's claim is recovered without risking a double print
 *   - concurrent agents never get the same job
 *   - a printer problem keeps jobs queued instead of failing them
 */

let db: FakeDb;

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => asClient(db),
}));

vi.mock("@/app/api/agent/auth", () => ({
  authenticateAgent: async (req: NextRequest) => ({
    ok: true,
    shopId: req.headers.get("x-printq-shop-id"),
    agentId: req.headers.get("x-printq-agent-id"),
  }),
}));

vi.mock("@/lib/storage", () => ({
  getSignedDownloadUrl: async (path: string) => `https://storage.test/${path}?signed`,
  downloadFile: async () => new Uint8Array(),
  deleteFile: async () => undefined,
  StorageObjectMissing: class extends Error {},
}));

const { POST: claim } = await import("@/app/api/agent/jobs/claim/route");
const { POST: attempted } = await import("@/app/api/agent/jobs/[jobId]/attempted/route");
const { POST: result } = await import("@/app/api/agent/jobs/[jobId]/result/route");

const SHOP = "5h0p0000-0000-4000-8000-000000000001";
const OTHER_SHOP = "5h0p0000-0000-4000-8000-000000000002";
const AGENT = "a6e70000-0000-4000-8000-000000000001";
const AGENT_2 = "a6e70000-0000-4000-8000-000000000002";
const PRINTER = "9r1n7e70-0000-4000-8000-000000000001";

function headers(agent = AGENT, shop = SHOP) {
  return { "x-printq-shop-id": shop, "x-printq-agent-id": agent, "x-printq-agent-secret": "s" };
}

const claimAs = (agent = AGENT, shop = SHOP) =>
  claim(new NextRequest("http://t/api/agent/jobs/claim", { method: "POST", headers: headers(agent, shop) }));

const attemptAs = (jobId: string, agent = AGENT) =>
  attempted(
    new NextRequest(`http://t/api/agent/jobs/${jobId}/attempted`, {
      method: "POST",
      headers: { ...headers(agent), "content-type": "application/json" },
      body: JSON.stringify({ attempt_number: 1 }),
    }),
    { params: Promise.resolve({ jobId }) }
  );

const reportAs = (jobId: string, body: Record<string, unknown>, agent = AGENT) =>
  result(
    new NextRequest(`http://t/api/agent/jobs/${jobId}/result`, {
      method: "POST",
      headers: { ...headers(agent), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );

let seq = 0;
/** One order + file + job. `created` orders the queue (oldest first). */
function addJob(opts: {
  state: string;
  paid?: boolean;
  shop?: string;
  claimedBy?: string | null;
  claimedAt?: string | null;
  token?: string;
}) {
  seq += 1;
  const orderId = `0rder000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const jobId = `j0b00000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const created = new Date(Date.parse("2026-10-01T08:00:00Z") + seq * 60_000).toISOString();
  db.table("orders").push({
    id: orderId,
    shop_id: opts.shop ?? SHOP,
    public_order_id: `PQ${seq}`,
    token_number: opts.token ?? `A${String(seq).padStart(3, "0")}`,
    payment_status: opts.paid === false ? "pending" : "paid",
    print_status: opts.state.toLowerCase(),
    color_mode: "bw",
    paper_size: "A4",
    orientation: "auto",
    sides: "single",
    copies: 1,
    page_range: "all",
    page_count: 3,
    color_ranges: null,
    fit_mode: "fit",
    printer_id: null,
    created_at: created,
  });
  db.table("order_files").push({
    id: `f11e${seq}`,
    order_id: orderId,
    storage_path: `${opts.shop ?? SHOP}/x/doc${seq}.pdf`,
    converted_storage_path: null,
    original_filename: `doc${seq}.pdf`,
    mime_type: "application/pdf",
    created_at: created,
  });
  db.table("print_jobs").push({
    id: jobId,
    order_id: orderId,
    state: opts.state,
    claimed_by_agent_id: opts.claimedBy ?? null,
    claimed_at: opts.claimedAt ?? null,
    created_at: created,
  });
  return { orderId, jobId };
}

beforeEach(() => {
  seq = 0;
  db = new FakeDb({
    printers: [
      {
        id: PRINTER,
        shop_id: SHOP,
        agent_id: AGENT,
        system_name: "HP LaserJet",
        display_name: "Counter printer",
        is_default: true,
        is_enabled: true,
        supports_color: false,
        supports_duplex: true,
        last_status: "ready",
      },
      {
        id: "9r1n7e70-0000-4000-8000-000000000002",
        shop_id: OTHER_SHOP,
        agent_id: AGENT_2,
        system_name: "Other",
        display_name: "Other",
        is_default: true,
        is_enabled: true,
        last_status: "ready",
      },
    ],
    print_attempts: [],
    audit_logs: [],
  });
});

describe("duplicate printing is impossible", () => {
  it("(a) a second 'attempted' report for the same job is rejected", async () => {
    const { jobId } = addJob({ state: "QUEUED" });
    expect((await claimAs()).status).toBe(200);

    const first = await attemptAs(jobId);
    const second = await attemptAs(jobId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(db.rows("print_attempts", { print_job_id: jobId })).toHaveLength(1);
  });

  it("(a) two simultaneous 'attempted' reports: exactly one wins", async () => {
    const { jobId } = addJob({ state: "QUEUED" });
    await claimAs();

    const responses = await Promise.all([attemptAs(jobId), attemptAs(jobId), attemptAs(jobId)]);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    expect(db.rows("print_attempts", { print_job_id: jobId })).toHaveLength(1);
  });

  it.each(["PRINT_ATTEMPTED", "PRINTING", "COMPLETED", "FAILED", "HELD", "CANCELLED"])(
    "(b) claim never returns a job that is %s",
    async (state) => {
      addJob({ state });
      const res = await claimAs();
      expect(res.status).toBe(204);
      expect(db.one("print_jobs", {}).state).toBe(state);
    }
  );

  it("(b) claim never returns a job awaiting approval or a top-up", async () => {
    addJob({ state: "PENDING_APPROVAL", paid: false });
    addJob({ state: "AWAITING_TOPUP" });
    expect((await claimAs()).status).toBe(204);
  });

  it("an agent whose claim was taken back cannot print it", async () => {
    const { jobId } = addJob({ state: "QUEUED" });
    await claimAs();
    // The owner edited the order: the claim is released back to the queue.
    db.one("print_jobs", { id: jobId }).state = "QUEUED";
    db.one("print_jobs", { id: jobId }).claimed_by_agent_id = null;

    // Refused either way: it is no longer this agent's job (404) or no
    // longer CLAIMED (409). What matters is it never gets a 200.
    expect([404, 409]).toContain((await attemptAs(jobId)).status);
    expect(db.rows("print_attempts")).toHaveLength(0);
  });

  it("another agent cannot report an attempt on a job it did not claim", async () => {
    const { jobId } = addJob({ state: "QUEUED" });
    await claimAs(AGENT);
    expect((await attemptAs(jobId, AGENT_2)).status).toBe(404);
  });

  it("a duplicate result report does not move a finished job", async () => {
    const { jobId } = addJob({ state: "QUEUED" });
    await claimAs();
    await attemptAs(jobId);
    expect((await reportAs(jobId, { result: "confirmed" })).status).toBe(200);
    expect((await reportAs(jobId, { result: "error", error_message: "late" })).status).toBe(409);
    expect(db.one("print_jobs", { id: jobId }).state).toBe("COMPLETED");
  });
});

describe("claim requires a verified, paid order", () => {
  it("never hands out a queued job whose order is not paid", async () => {
    addJob({ state: "QUEUED", paid: false });
    expect((await claimAs()).status).toBe(204);
  });

  it("hands out the paid one and skips the unpaid one", async () => {
    addJob({ state: "QUEUED", paid: false });
    const paid = addJob({ state: "QUEUED" });
    const res = await claimAs();
    expect(res.status).toBe(200);
    expect((await res.json()).jobId).toBe(paid.jobId);
  });

  it("never hands one shop's job to another shop's agent", async () => {
    addJob({ state: "QUEUED", shop: OTHER_SHOP });
    expect((await claimAs(AGENT, SHOP)).status).toBe(204);
  });
});

describe("stale claims heal themselves", () => {
  it("requeues a job left CLAIMED past the limit and hands it out again", async () => {
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60_000).toISOString();
    const { jobId } = addJob({ state: "CLAIMED", claimedBy: AGENT_2, claimedAt: elevenMinutesAgo });

    const res = await claimAs(AGENT);
    expect(res.status).toBe(200);
    expect((await res.json()).jobId).toBe(jobId);
    expect(db.one("print_jobs", { id: jobId }).claimed_by_agent_id).toBe(AGENT);
    expect(db.rows("audit_logs", { action: "job.claim_expired" })).toHaveLength(1);

    // The agent that vanished comes back and tries to print it: refused.
    expect((await attemptAs(jobId, AGENT_2)).status).toBe(404);
  });

  it("leaves a recent claim alone", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    const { jobId } = addJob({ state: "CLAIMED", claimedBy: AGENT_2, claimedAt: twoMinutesAgo });
    expect((await claimAs(AGENT)).status).toBe(204);
    expect(db.one("print_jobs", { id: jobId }).claimed_by_agent_id).toBe(AGENT_2);
  });

  it("never requeues a job that may already be on paper", async () => {
    const anHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { jobId } = addJob({ state: "PRINT_ATTEMPTED", claimedBy: AGENT_2, claimedAt: anHourAgo });
    expect((await claimAs(AGENT)).status).toBe(204);
    expect(db.one("print_jobs", { id: jobId }).state).toBe("PRINT_ATTEMPTED");
  });
});

describe("ordering and concurrency", () => {
  it("serves the queue oldest first", async () => {
    const jobs = [addJob({ state: "QUEUED" }), addJob({ state: "QUEUED" }), addJob({ state: "QUEUED" })];
    const served: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await claimAs();
      served.push((await res.json()).jobId);
    }
    expect(served).toEqual(jobs.map((j) => j.jobId));
  });

  it("two agents polling at once never receive the same job", async () => {
    const jobs = Array.from({ length: 6 }, () => addJob({ state: "QUEUED" }));

    const handedOut: string[] = [];
    // A burst of simultaneous polls. A poll that loses every race in its
    // candidate window returns "nothing yet" and the next one picks up the
    // rest, so keep polling until the queue is empty.
    for (let round = 0; round < 5; round++) {
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) => claimAs(i % 2 === 0 ? AGENT : AGENT_2, SHOP))
      );
      for (const r of responses) if (r.status === 200) handedOut.push((await r.json()).jobId);
      if (db.rows("print_jobs", { state: "QUEUED" }).length === 0) break;
    }

    expect(handedOut).toHaveLength(6);
    expect(new Set(handedOut).size).toBe(6);
    expect(new Set(handedOut)).toEqual(new Set(jobs.map((j) => j.jobId)));
  });

  it("orders placed while the agent was offline print in order once it returns", async () => {
    // Nothing polls while the PC is off; customers keep paying.
    const placed = Array.from({ length: 4 }, () => addJob({ state: "QUEUED" }));
    expect(db.rows("print_jobs", { state: "QUEUED" })).toHaveLength(4);

    // The agent comes back and drains the queue.
    for (const { jobId } of placed) {
      const res = await claimAs();
      expect((await res.json()).jobId).toBe(jobId);
      expect((await attemptAs(jobId)).status).toBe(200);
      expect((await reportAs(jobId, { result: "confirmed" })).status).toBe(200);
    }
    expect(db.rows("print_jobs", { state: "COMPLETED" })).toHaveLength(4);
  });
});

describe("printer problems", () => {
  it("keeps jobs queued while the chosen printer is out of paper", async () => {
    const { jobId } = addJob({ state: "QUEUED" });
    db.one("printers", { id: PRINTER }).last_status = "out_of_paper";

    const res = await claimAs();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("printer_problem");
    expect(body.error).toMatch(/Out of paper/);
    expect(db.one("print_jobs", { id: jobId }).state).toBe("QUEUED");
  });

  it("never substitutes another printer", async () => {
    addJob({ state: "QUEUED" });
    db.one("printers", { id: PRINTER }).last_status = "cover_open";
    db.table("printers").push({
      id: "spare",
      shop_id: SHOP,
      agent_id: AGENT,
      system_name: "Spare",
      display_name: "Spare",
      is_default: false,
      is_enabled: true,
      last_status: "ready",
    });
    expect((await claimAs()).status).toBe(409);
  });

  it("records a classified print error so the owner can tell causes apart", async () => {
    const { jobId, orderId } = addJob({ state: "QUEUED" });
    await claimAs();
    await attemptAs(jobId);
    await reportAs(jobId, { result: "error", error_message: "Spooler said no", error_code: "printer_rejected" });

    expect(db.one("print_attempts", { print_job_id: jobId }).error_code).toBe("printer_rejected");
    expect(db.one("orders", { id: orderId }).failure_reason).toMatch(/^The printer refused the document/);
  });

  it("drops an error code it doesn't know rather than storing it", async () => {
    const { jobId } = addJob({ state: "QUEUED" });
    await claimAs();
    await attemptAs(jobId);
    await reportAs(jobId, { result: "error", error_message: "x", error_code: "<script>" });
    expect(db.one("print_attempts", { print_job_id: jobId }).error_code).toBeNull();
  });
});

describe("mixed-colour orders reach the agent as print passes", () => {
  it("sends one pass per colour run, in page order", async () => {
    const { orderId } = addJob({ state: "QUEUED" });
    const order = db.one("orders", { id: orderId });
    order.page_count = 6;
    order.color_ranges = [{ range: "3-4", mode: "color" }];

    const body = await (await claimAs()).json();
    expect(body.printSettings.colorSegments).toEqual([
      { pageRange: "1-2", colorMode: "bw" },
      { pageRange: "3-4", colorMode: "color" },
      { pageRange: "5-6", colorMode: "bw" },
    ]);
    expect(body.printSettings.fitMode).toBe("fit");
  });

  it("sends no passes for a single-mode order, so it prints exactly as before", async () => {
    addJob({ state: "QUEUED" });
    const body = await (await claimAs()).json();
    expect(body.printSettings.colorSegments).toBeNull();
  });
});
