import { describe, it, expect } from "vitest";
import { FakeDb, asClient } from "./fakeSupabase";
import { purgeExpiredFiles } from "../jobMaintenance";
import { deriveOrderState } from "../orderStatus";
import { PRINT_RESULT_UNCERTAIN_AFTER_SECONDS } from "../jobState";
import { controlsFrom, orderingBlock, uploadBlock } from "../shopControls";
import { rateLimitKey, UPLOAD_RATE_LIMIT, clientIp } from "../rateLimit";

const SHOP = "5a0b0000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function seedFiles(rows: { status: string; payment: string; age: number; shop?: string }[]) {
  const db = new FakeDb({ orders: [], order_files: [], print_jobs: [], payments: [] });
  rows.forEach((r, i) => {
    db.table("orders").push({ id: `o${i}`, shop_id: r.shop ?? SHOP, print_status: r.status, payment_status: r.payment });
    db.table("order_files").push({
      id: `f${i}`,
      order_id: `o${i}`,
      storage_path: `${r.shop ?? SHOP}/x/f${i}.pdf`,
      converted_storage_path: null,
      deleted_at: null,
      created_at: hoursAgo(r.age),
    });
    db.table("print_jobs").push({ id: `j${i}`, order_id: `o${i}`, state: r.status.toUpperCase() });
  });
  return db;
}

describe("retention cleanup", () => {
  const run = async (db: FakeDb, removed: string[] = []) =>
    purgeExpiredFiles(asClient(db), SHOP, 24, { removeObject: async (p) => void removed.push(p) }, NOW);

  it("deletes finished orders' files once retention has passed", async () => {
    const db = seedFiles([
      { status: "completed", payment: "paid", age: 30 },
      { status: "cancelled", payment: "paid", age: 30 },
      { status: "completed", payment: "paid", age: 2 },
    ]);
    const removed: string[] = [];
    const r = await run(db, removed);
    expect(r.deleted).toBe(2);
    expect(removed).toEqual([`${SHOP}/x/f0.pdf`, `${SHOP}/x/f1.pdf`]);
    expect(db.one("order_files", { id: "f2" }).deleted_at).toBeNull();
  });

  it("never deletes the file of a paid order still waiting to print, however old", async () => {
    const db = seedFiles([
      { status: "queued", payment: "paid", age: 100 },
      { status: "held", payment: "paid", age: 100 },
      { status: "awaiting_topup", payment: "paid", age: 100 },
      { status: "print_attempted", payment: "paid", age: 100 },
    ]);
    const r = await run(db);
    expect(r.deleted).toBe(0);
  });

  it("expires an abandoned unpaid order along with its file, so it can't be paid later", async () => {
    const db = seedFiles([{ status: "payment_pending", payment: "pending", age: 30 }]);
    db.table("payments").push({ id: "p0", order_id: "o0", status: "pending", cashfree_order_id: "o0", payment_session_id: "s" });
    const terminated: string[] = [];
    const r = await purgeExpiredFiles(
      asClient(db),
      SHOP,
      24,
      { removeObject: async () => undefined, terminateCheckout: async (id) => (terminated.push(id), true) },
      NOW
    );
    expect(r).toMatchObject({ deleted: 1, expiredOrders: 1 });
    expect(db.one("orders", { id: "o0" })).toMatchObject({ payment_status: "expired", print_status: "cancelled" });
    expect(db.one("payments", { id: "p0" }).status).toBe("expired");
    expect(terminated).toEqual(["o0"]);
  });

  it("only touches the calling shop's files", async () => {
    const db = seedFiles([{ status: "completed", payment: "paid", age: 30, shop: "other-shop" }]);
    expect((await run(db)).deleted).toBe(0);
  });

  it("keeps the record and retries next time if storage refuses", async () => {
    const db = seedFiles([{ status: "completed", payment: "paid", age: 30 }]);
    const r = await purgeExpiredFiles(
      asClient(db),
      SHOP,
      24,
      { removeObject: async () => Promise.reject(new Error("503")) },
      NOW
    );
    expect(r.failed).toBe(1);
    expect(db.one("order_files", { id: "f0" }).deleted_at).toBeNull();
  });
});

describe("dashboard states for the new flows", () => {
  const base = { agentOnline: true, printerAvailable: true, now: NOW };

  it("pending approval needs the owner", () => {
    const s = deriveOrderState({ ...base, paymentStatus: "pending", printStatus: "pending_approval", jobState: "PENDING_APPROVAL" });
    expect(s.key).toBe("pending_approval");
    expect(s.blocked).toBe(true);
  });

  it("an attempt with no result for too long is 'Print result uncertain'", () => {
    const started = new Date(NOW.getTime() - (PRINT_RESULT_UNCERTAIN_AFTER_SECONDS + 5) * 1000).toISOString();
    const s = deriveOrderState({ ...base, paymentStatus: "paid", printStatus: "print_attempted", jobState: "PRINT_ATTEMPTED", printStartedAt: started });
    expect(s.label).toBe("Print result uncertain");
    expect(s.detail).toMatch(/owner review required/);
  });

  it("a fresh attempt is still just printing", () => {
    const s = deriveOrderState({ ...base, paymentStatus: "paid", printStatus: "print_attempted", jobState: "PRINT_ATTEMPTED", printStartedAt: NOW.toISOString() });
    expect(s.key).toBe("printing");
  });

  it("a queued order behind a printer problem says so", () => {
    const s = deriveOrderState({ ...base, paymentStatus: "paid", printStatus: "queued", jobState: "QUEUED", printerProblem: "Out of paper" });
    expect(s.label).toBe("⚠ Printer issue");
    expect(s.detail).toMatch(/Out of paper/);
  });

  it("a queued order behind an outdated agent says to update it", () => {
    const s = deriveOrderState({ ...base, paymentStatus: "paid", printStatus: "queued", jobState: "QUEUED", agentUpdateNeeded: true });
    expect(s.label).toBe("Waiting — update the agent");
    expect(s.blocked).toBe(true);
  });

  it("awaiting a top-up is not 'in queue'", () => {
    const s = deriveOrderState({ ...base, paymentStatus: "paid", printStatus: "awaiting_topup", jobState: "AWAITING_TOPUP" });
    expect(s.key).toBe("awaiting_topup");
  });

  it("rejected shows the owner's reason", () => {
    const s = deriveOrderState({ ...base, paymentStatus: "expired", printStatus: "rejected", jobState: "REJECTED", failureReason: "Blurry" });
    expect(s.key).toBe("rejected");
    expect(s.detail).toMatch(/Blurry/);
  });
});

describe("shop switches", () => {
  it("defaults to open, accepting, automatic", () => {
    expect(controlsFrom(null)).toEqual({ shopOpen: true, acceptingOrders: true, printingMode: "automatic" });
  });
  it("closed blocks uploads and orders; paused blocks only orders", () => {
    const closed = controlsFrom({ shop_open: false, accepting_orders: true });
    const paused = controlsFrom({ shop_open: true, accepting_orders: false });
    expect(orderingBlock(closed)?.code).toBe("shop_closed");
    expect(uploadBlock(closed)?.code).toBe("shop_closed");
    expect(orderingBlock(paused)?.code).toBe("orders_paused");
    expect(uploadBlock(paused)).toBeNull();
  });
});

describe("rate-limit keys", () => {
  it("are per shop and per address, and never contain the address", () => {
    const a = rateLimitKey(UPLOAD_RATE_LIMIT, "shop-1", "203.0.113.7");
    expect(a).not.toContain("203.0.113.7");
    expect(a).not.toBe(rateLimitKey(UPLOAD_RATE_LIMIT, "shop-2", "203.0.113.7"));
    expect(a).not.toBe(rateLimitKey(UPLOAD_RATE_LIMIT, "shop-1", "203.0.113.8"));
  });
  it("use the first X-Forwarded-For hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
});
