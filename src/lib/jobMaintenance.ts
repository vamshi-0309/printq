import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Self-healing that piggybacks on requests the agent already makes, so there
 * is no scheduler to run or forget about.
 *
 *   requeueStaleClaims  — called by the claim route, for the calling shop
 *   purgeExpiredFiles   — called by the heartbeat route, for the calling shop
 *
 * Both only ever act on the authenticated shop's own rows, both are bounded,
 * and both write with compare-and-swap so they can run concurrently with
 * anything else without undoing it.
 */

/**
 * How long a job may stay CLAIMED before it is handed out again.
 *
 * CLAIMED means the agent took the job but has not yet told us it is sending
 * it to the printer — it is downloading and, for Word/PowerPoint, converting.
 * Nothing has reached a printer, so putting it back is always safe: if the
 * original agent turns out to be alive after all, its "attempted" report is a
 * compare-and-swap on CLAIMED-by-me and fails, and it prints nothing.
 *
 * Ten minutes rather than the three suggested: a 50 MB upload on a slow
 * counter connection plus LibreOffice's 120-second conversion can genuinely
 * take longer than three minutes, and a limit shorter than real work would
 * requeue a healthy job forever.
 */
export const STALE_CLAIM_SECONDS = 600;

/** Bounded per call so one request never does unbounded work. */
export const STALE_CLAIM_BATCH = 10;
export const RETENTION_BATCH = 20;

export async function requeueStaleClaims(
  db: SupabaseClient,
  shopId: string,
  now: Date = new Date(),
  staleSeconds: number = STALE_CLAIM_SECONDS
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleSeconds * 1000).toISOString();

  const { data, error } = await db
    .from("print_jobs")
    .select("id, order_id, state, claimed_at, claimed_by_agent_id, orders!inner(id, shop_id)")
    .eq("state", "CLAIMED")
    .eq("orders.shop_id", shopId)
    .lt("claimed_at", cutoff)
    .order("claimed_at", { ascending: true })
    .limit(STALE_CLAIM_BATCH);

  if (error) {
    console.error(`[stale-claims] shop=${shopId} lookup failed: ${error.message}`);
    return 0;
  }

  let requeued = 0;
  for (const job of data ?? []) {
    // Matched on the claim time read above as well as the state, so a job
    // that was legitimately re-claimed in between is left alone.
    const { data: moved } = await db
      .from("print_jobs")
      .update({ state: "QUEUED", claimed_by_agent_id: null, claimed_at: null })
      .eq("id", job.id)
      .eq("state", "CLAIMED")
      .eq("claimed_at", job.claimed_at)
      .select("id");
    if (!moved || moved.length === 0) continue;

    requeued += 1;
    await db
      .from("orders")
      .update({ print_status: "queued" })
      .eq("id", job.order_id)
      .eq("shop_id", shopId)
      .eq("print_status", "claimed");
    await db.from("audit_logs").insert({
      actor_type: "system",
      actor_id: null,
      shop_id: shopId,
      action: "job.claim_expired",
      target_table: "print_jobs",
      target_id: job.id,
      metadata: { claimed_at: job.claimed_at, agent_id: job.claimed_by_agent_id, stale_after_seconds: staleSeconds },
    });
  }
  return requeued;
}

/* ── Retention ───────────────────────────────────────────────────── */

/** Order states whose files are no longer needed once retention passes. */
const FINISHED = ["completed", "cancelled", "rejected", "failed"];
/** Never paid: abandoned once retention passes, and expired with the file. */
const UNPAID = ["created", "payment_pending", "pending_approval"];

export interface PurgeDeps {
  removeObject: (storagePath: string) => Promise<void>;
  /** Stops an abandoned order's open checkout being paid. Best effort. */
  terminateCheckout?: (cashfreeOrderId: string) => Promise<boolean>;
}

export type PurgeResult = { deleted: number; expiredOrders: number; failed: number };

/**
 * Delete customer files older than the shop's retention setting.
 *
 * shop_settings.file_retention_hours has always been shown to owners ("Files
 * are deleted automatically after 24 hours") but nothing ever deleted
 * anything. This does, for orders that are finished or were never paid.
 * A paid order that is still waiting to print is never touched, however old:
 * deleting its file would make a paid job unprintable.
 *
 * An unpaid order whose file is deleted is expired at the same time — it can
 * no longer be printed, so it must no longer be payable.
 */
export async function purgeExpiredFiles(
  db: SupabaseClient,
  shopId: string,
  retentionHours: number,
  deps: PurgeDeps,
  now: Date = new Date()
): Promise<PurgeResult> {
  const result: PurgeResult = { deleted: 0, expiredOrders: 0, failed: 0 };
  const hours = Number.isFinite(retentionHours) && retentionHours > 0 ? retentionHours : 24;
  const cutoff = new Date(now.getTime() - hours * 3600 * 1000).toISOString();

  const { data, error } = await db
    .from("order_files")
    .select(
      "id, order_id, storage_path, converted_storage_path, created_at, orders!inner(id, shop_id, print_status, payment_status)"
    )
    .is("deleted_at", null)
    .lt("created_at", cutoff)
    .eq("orders.shop_id", shopId)
    .in("orders.print_status", [...FINISHED, ...UNPAID])
    .order("created_at", { ascending: true })
    .limit(RETENTION_BATCH);

  if (error) {
    console.error(`[retention] shop=${shopId} lookup failed: ${error.message}`);
    return result;
  }

  for (const file of data ?? []) {
    const order = (file as unknown as { orders: { print_status: string; payment_status: string } }).orders;
    const unpaid = UNPAID.includes(order.print_status) && order.payment_status !== "paid";
    if (!FINISHED.includes(order.print_status) && !unpaid) continue;

    if (unpaid) {
      const expired = await expireUnpaidOrder(db, file.order_id as string, shopId, order.print_status, deps);
      if (!expired) continue; // paid in the meantime: keep the file
      result.expiredOrders += 1;
    }

    const ok = await deleteStoredFile(db, file as { id: string; storage_path: string; converted_storage_path: string | null }, deps);
    if (ok) result.deleted += 1;
    else result.failed += 1;
  }
  return result;
}

async function expireUnpaidOrder(
  db: SupabaseClient,
  orderId: string,
  shopId: string,
  printStatus: string,
  deps: PurgeDeps
): Promise<boolean> {
  const { data: moved } = await db
    .from("orders")
    .update({ payment_status: "expired", print_status: "cancelled", failure_reason: "Expired before it was paid for." })
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .eq("print_status", printStatus)
    .neq("payment_status", "paid")
    .select("id");
  if (!moved || moved.length === 0) return false;

  await db.from("print_jobs").update({ state: "CANCELLED" }).eq("order_id", orderId).neq("state", "CANCELLED");

  const { data: open } = await db
    .from("payments")
    .select("id, cashfree_order_id, payment_session_id")
    .eq("order_id", orderId)
    .eq("status", "pending");
  for (const p of open ?? []) {
    await db.from("payments").update({ status: "expired" }).eq("id", p.id).eq("status", "pending");
    if (p.cashfree_order_id && p.payment_session_id && deps.terminateCheckout) {
      await deps.terminateCheckout(p.cashfree_order_id);
    }
  }
  return true;
}

/**
 * Remove one order's stored document (and its converted PDF). The row is
 * kept, with deleted_at set, as the record that it existed. A failed removal
 * leaves deleted_at unset so the next pass tries again.
 */
export async function deleteStoredFile(
  db: SupabaseClient,
  file: { id: string; storage_path: string; converted_storage_path: string | null },
  deps: Pick<PurgeDeps, "removeObject">
): Promise<boolean> {
  try {
    await deps.removeObject(file.storage_path);
    if (file.converted_storage_path) await deps.removeObject(file.converted_storage_path);
  } catch (err) {
    console.error(`[retention] could not delete ${file.storage_path}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
  await db.from("order_files").update({ deleted_at: new Date().toISOString() }).eq("id", file.id);
  return true;
}

/** Delete every stored file of one order now — used when an order is rejected. */
export async function deleteOrderFiles(
  db: SupabaseClient,
  orderId: string,
  deps: Pick<PurgeDeps, "removeObject">
): Promise<number> {
  const { data } = await db
    .from("order_files")
    .select("id, storage_path, converted_storage_path")
    .eq("order_id", orderId)
    .is("deleted_at", null);
  let deleted = 0;
  for (const f of data ?? []) {
    if (await deleteStoredFile(db, f as { id: string; storage_path: string; converted_storage_path: string | null }, deps)) {
      deleted += 1;
    }
  }
  return deleted;
}
