import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb, asClient } from "./fakeSupabase";
import { editOrder, type EditDeps } from "../orderEdit";
import { applyGatewayPayment, settleBalance } from "../orderPayment";
import { moneyHeld, type GatewayClient, type PaymentRow } from "../orderMoney";
import { refundableAmount, availableActions } from "../orderActions";

/**
 * An owner edits an order after the customer has (or hasn't) paid.
 *
 * Prices here: A4 B&W ₹1/page, colour ₹5/page, no minimum, so a 10-page
 * single copy is ₹10 and every assertion is easy to check by hand.
 */

const SHOP = "aaaaaaaa-0000-4000-8000-000000000001";
const ORDER = "bbbbbbbb-0000-4000-8000-000000000001";
const JOB = "cccccccc-0000-4000-8000-000000000001";

function fakeGateway() {
  const calls = {
    create: [] as { cashfreeOrderId?: string; amount: number }[],
    refund: [] as { cashfreeOrderId: string; amount: number; refundId: string }[],
    terminate: [] as string[],
  };
  const gateway: GatewayClient = {
    async createOrder(input) {
      calls.create.push({ cashfreeOrderId: input.cashfreeOrderId, amount: input.amount });
      return {
        paymentSessionId: `session_${input.cashfreeOrderId}`,
        cfOrderId: `cf_${calls.create.length}`,
        orderId: input.cashfreeOrderId ?? input.orderUuid,
      };
    },
    async refund(input) {
      calls.refund.push({ cashfreeOrderId: input.cashfreeOrderId, amount: input.amount, refundId: input.refundId });
      return { refundId: input.refundId, cfRefundId: "cfr_1", status: "PENDING" };
    },
    async terminate(id) {
      calls.terminate.push(id);
      return true;
    },
  };
  return { gateway, calls };
}

const URLS = { returnUrl: "https://x/p/s?cf_return=1", notifyUrl: "https://x/api/payments/cashfree/webhook" };

function seed(opts: {
  paid: boolean;
  jobState: string;
  amount?: number;
  shopGateway?: string | null;
  session?: boolean;
  printStatus?: string;
}) {
  const amount = opts.amount ?? 10;
  const viaCashfree = opts.shopGateway === undefined || opts.shopGateway === "cashfree";
  return new FakeDb({
    shop_settings: [{ shop_id: SHOP, payment_gateway: opts.shopGateway === undefined ? "cashfree" : opts.shopGateway }],
    pricing: [
      {
        shop_id: SHOP,
        a4_bw_per_page: 1,
        a4_color_per_page: 5,
        a3_bw_per_page: 2,
        a3_color_per_page: 8,
        duplex_discount_percent: 0,
        minimum_order_amount: 0,
        enabled_paper_sizes: ["A4", "A3"],
      },
    ],
    orders: [
      {
        id: ORDER,
        shop_id: SHOP,
        public_order_id: "PQ200",
        token_number: opts.paid ? "A047" : null,
        copies: 1,
        color_mode: "bw",
        paper_size: "A4",
        sides: "single",
        orientation: "auto",
        page_range: "all",
        page_count: 10,
        color_ranges: null,
        fit_mode: "fit",
        price_breakdown: { total: amount, documentPages: 10 },
        amount,
        payment_status: opts.paid ? "paid" : "pending",
        print_status: opts.printStatus ?? (opts.paid ? "queued" : "payment_pending"),
      },
    ],
    print_jobs: [{ id: JOB, order_id: ORDER, state: opts.jobState, claimed_by_agent_id: null }],
    order_files: [{ order_id: ORDER, storage_path: `${SHOP}/x/doc.pdf`, deleted_at: null }],
    payments: [
      {
        id: "pay-original",
        order_id: ORDER,
        purpose: "order",
        method: viaCashfree ? "gateway" : "upi_intent",
        gateway: viaCashfree ? "cashfree" : null,
        amount,
        status: opts.paid ? "paid" : "pending",
        cashfree_order_id: viaCashfree ? ORDER : null,
        payment_session_id: viaCashfree && (opts.session ?? true) ? "session_original" : null,
        refund_status: null,
        refund_amount: null,
        created_at: "2026-10-01T08:00:00.000Z",
      },
    ],
    audit_logs: [],
  }, {
    rpc: { get_next_token: () => 48 },
  });
}

let gw: ReturnType<typeof fakeGateway>;
let deps: EditDeps;
beforeEach(() => {
  gw = fakeGateway();
  deps = { gateway: gw.gateway, urls: URLS, documentPages: async () => 10 };
});

const edit = (db: FakeDb, changes: Record<string, unknown>, confirmRefund = false) =>
  editOrder(asClient(db), deps, { orderId: ORDER, shopId: SHOP, actorId: "owner-1", changes, confirmRefund });

const payments = (db: FakeDb) => db.rows("payments") as unknown as PaymentRow[];
const jobState = (db: FakeDb) => db.one("print_jobs", { id: JOB }).state;

describe("paid order, price goes UP → top-up", () => {
  it("parks the job as AWAITING_TOPUP with a top-up for exactly the difference", async () => {
    const db = seed({ paid: true, jobState: "QUEUED" });
    const r = await edit(db, { copies: 3 }); // ₹10 → ₹30

    expect(r.ok && r.outcome).toBe("topup");
    expect(r.ok && r.amount).toBe(30);
    expect(jobState(db)).toBe("AWAITING_TOPUP");
    expect(db.one("orders", { id: ORDER }).print_status).toBe("awaiting_topup");

    const topup = payments(db).find((p) => p.purpose === "topup")!;
    expect(Number(topup.amount)).toBe(20);
    expect(topup.status).toBe("pending");
    expect(topup.cashfree_order_id).toBe(`${ORDER}-t1`);
    expect(topup.payment_session_id).toBe(`session_${ORDER}-t1`);
    expect(gw.calls.create).toEqual([{ cashfreeOrderId: `${ORDER}-t1`, amount: 20 }]);
  });

  it("returns the job to the queue once the top-up webhook is verified", async () => {
    const db = seed({ paid: true, jobState: "QUEUED" });
    await edit(db, { copies: 3 });

    const res = await applyGatewayPayment(asClient(db), gw.gateway, URLS, `${ORDER}-t1`, {
      gatewayPaymentId: "cfpay_topup",
    });
    expect(res.ok && res.purpose).toBe("topup");
    expect(jobState(db)).toBe("QUEUED");
    expect(db.one("orders", { id: ORDER }).print_status).toBe("queued");
    expect(moneyHeld(payments(db))).toBe(30);
    // The token is unchanged — this is the same order, not a new one.
    expect(db.one("orders", { id: ORDER }).token_number).toBe("A047");
  });

  it("a duplicate top-up webhook changes nothing", async () => {
    const db = seed({ paid: true, jobState: "QUEUED" });
    await edit(db, { copies: 3 });
    await applyGatewayPayment(asClient(db), gw.gateway, URLS, `${ORDER}-t1`);
    const snapshot = JSON.stringify(db.tables);
    const dup = await applyGatewayPayment(asClient(db), gw.gateway, URLS, `${ORDER}-t1`);
    expect(dup.ok && dup.duplicate).toBe(true);
    expect(JSON.stringify(db.tables)).toBe(snapshot);
  });

  it("raising it again replaces the first top-up rather than stacking a second", async () => {
    const db = seed({ paid: true, jobState: "QUEUED" });
    await edit(db, { copies: 3 }); // owes 20
    await edit(db, { copies: 5 }); // owes 40

    const topups = payments(db).filter((p) => p.purpose === "topup");
    expect(topups.map((t) => [t.cashfree_order_id, Number(t.amount), t.status])).toEqual([
      [`${ORDER}-t1`, 20, "expired"],
      [`${ORDER}-t2`, 40, "pending"],
    ]);
    expect(gw.calls.terminate).toEqual([`${ORDER}-t1`]);
  });

  it("lowering it back to what was paid cancels the top-up and re-queues", async () => {
    const db = seed({ paid: true, jobState: "QUEUED" });
    await edit(db, { copies: 3 });
    const r = await edit(db, { copies: 1 });

    expect(r.ok && r.outcome).toBe("updated");
    expect(jobState(db)).toBe("QUEUED");
    expect(payments(db).filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("works for a counter-paid shop: a top-up row with no Cashfree order", async () => {
    const db = seed({ paid: true, jobState: "QUEUED", shopGateway: null });
    await edit(db, { copies: 2 });
    const topup = payments(db).find((p) => p.purpose === "topup")!;
    expect(topup.gateway).toBeNull();
    expect(topup.cashfree_order_id).toBeNull();
    expect(gw.calls.create).toHaveLength(0);
    expect(jobState(db)).toBe("AWAITING_TOPUP");
  });
});

describe("paid order, price goes DOWN → refund", () => {
  it("refuses until the owner confirms the exact refund, changing nothing", async () => {
    const db = seed({ paid: true, jobState: "QUEUED", amount: 10 });
    const before = JSON.stringify(db.tables);
    const r = await edit(db, { pageRange: "1-5" }); // ₹10 → ₹5

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("needs_refund_confirmation");
    expect(r.refundAmount).toBe(5);
    expect(r.error).toBe("Refund ₹5 to the customer for this change?");
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(gw.calls.refund).toHaveLength(0);
  });

  it("once confirmed, refunds the difference through Cashfree on the original payment", async () => {
    const db = seed({ paid: true, jobState: "QUEUED", amount: 10 });
    const r = await edit(db, { pageRange: "1-5" }, true);

    expect(r.ok && r.outcome).toBe("refunded");
    expect(gw.calls.refund).toHaveLength(1);
    expect(gw.calls.refund[0]).toMatchObject({ cashfreeOrderId: ORDER, amount: 5 });

    const original = db.one("payments", { id: "pay-original" });
    expect(original.refund_status).toBe("pending");
    expect(Number(original.refund_amount)).toBe(5);
    expect(db.one("orders", { id: ORDER }).amount).toBe(5);
    expect(db.one("orders", { id: ORDER }).page_range).toBe("1-5");
    // Still printable: the customer has paid at least the new price.
    expect(jobState(db)).toBe("QUEUED");
    expect(moneyHeld(payments(db))).toBe(5);
  });

  it("a failed refund leaves the shortfall visible as a refund due", async () => {
    const db = seed({ paid: true, jobState: "QUEUED", amount: 10 });
    gw.gateway.refund = async () => {
      throw new Error("insufficient balance");
    };
    const r = await edit(db, { pageRange: "1-5" }, true);
    expect(r.ok && r.refund?.ok).toBe(false);
    expect(r.ok && r.warning).toMatch(/Refund/);

    const held = moneyHeld(payments(db));
    expect(held).toBe(10);
    const owed = refundableAmount("queued", 5, held);
    expect(owed).toBe(5);
    expect(availableActions("QUEUED", "paid", { refundableAmount: owed }).map((a) => a.action)).toContain("refund");
  });
});

describe("unpaid order", () => {
  it("re-issues the Cashfree session at the new amount and retires the old one", async () => {
    const db = seed({ paid: false, jobState: "CREATED" });
    const r = await edit(db, { copies: 2 }); // ₹10 → ₹20

    expect(r.ok && r.outcome).toBe("reissued");
    const rows = payments(db);
    expect(rows.find((p) => p.id === "pay-original")!.status).toBe("expired");
    const fresh = rows.find((p) => p.cashfree_order_id === `${ORDER}-r2`)!;
    expect(Number(fresh.amount)).toBe(20);
    expect(fresh.status).toBe("pending");
    expect(fresh.payment_session_id).toBe(`session_${ORDER}-r2`);
    expect(gw.calls.terminate).toEqual([ORDER]);
  });

  it("if the customer pays the stale session anyway, the money is kept and the order reconciled", async () => {
    const db = seed({ paid: false, jobState: "CREATED" });
    await edit(db, { copies: 2 }); // now ₹20; old session was ₹10

    // The customer had the old checkout open and paid ₹10 on it.
    const res = await applyGatewayPayment(asClient(db), gw.gateway, URLS, ORDER, {
      gatewayPaymentId: "cfpay_stale",
    });
    expect(res.ok).toBe(true);
    const order = db.one("orders", { id: ORDER });
    expect(order.payment_status).toBe("paid");
    expect(order.token_number).toBeTruthy();
    // ₹10 of ₹20 paid: waits for the rest, unclaimable.
    expect(jobState(db)).toBe("AWAITING_TOPUP");
    const topup = payments(db).find((p) => p.purpose === "topup" && p.status === "pending")!;
    expect(Number(topup.amount)).toBe(10);
    // The re-issued ₹20 session is retired so the customer can't pay twice.
    expect(payments(db).find((p) => p.cashfree_order_id === `${ORDER}-r2`)!.status).toBe("expired");
  });

  it("a counter-paid order just carries the new amount", async () => {
    const db = seed({ paid: false, jobState: "CREATED", shopGateway: null });
    const r = await edit(db, { copies: 3 });
    expect(r.ok && r.outcome).toBe("updated");
    expect(Number(db.one("payments", { id: "pay-original" }).amount)).toBe(30);
    expect(gw.calls.create).toHaveLength(0);
  });

  it("an order awaiting approval is repriced without creating any checkout", async () => {
    const db = seed({ paid: false, jobState: "PENDING_APPROVAL", session: false, printStatus: "pending_approval" });
    await edit(db, { colorMode: "color" }); // ₹10 → ₹50
    expect(Number(db.one("payments", { id: "pay-original" }).amount)).toBe(50);
    expect(gw.calls.create).toHaveLength(0);
  });
});

describe("which orders can be edited", () => {
  it("releases a claimed job back to the queue so the agent cannot print the old settings", async () => {
    const db = seed({ paid: true, jobState: "CLAIMED", printStatus: "claimed" });
    db.one("print_jobs", { id: JOB }).claimed_by_agent_id = "agent-1";
    const r = await edit(db, { sides: "double" });
    expect(r.ok).toBe(true);
    const job = db.one("print_jobs", { id: JOB });
    expect(job.state).toBe("QUEUED");
    expect(job.claimed_by_agent_id).toBeNull();
  });

  it.each(["PRINT_ATTEMPTED", "PRINTING", "COMPLETED", "CANCELLED"])(
    "refuses an order whose job is %s",
    async (state) => {
      const db = seed({ paid: true, jobState: state });
      const before = JSON.stringify(db.tables);
      const r = await edit(db, { copies: 2 });
      expect(r.ok).toBe(false);
      expect(JSON.stringify(db.tables)).toBe(before);
    }
  );

  it("records every edit in the audit log with before and after", async () => {
    const db = seed({ paid: true, jobState: "QUEUED" });
    await edit(db, { copies: 2 });
    const log = db.one("audit_logs", { action: "order.edited" });
    const meta = log.metadata as { before: { amount: number; copies: number }; after: { amount: number; copies: number } };
    expect(meta.before).toMatchObject({ amount: 10, copies: 1 });
    expect(meta.after).toMatchObject({ amount: 20, copies: 2 });
  });

  it("an edit that changes nothing writes nothing", async () => {
    const db = seed({ paid: true, jobState: "QUEUED" });
    const r = await edit(db, { copies: 1 });
    expect(r.ok && r.outcome).toBe("unchanged");
    expect(db.rows("audit_logs")).toHaveLength(0);
  });
});

describe("settleBalance is idempotent", () => {
  it("running it repeatedly on an underpaid order keeps exactly one top-up", async () => {
    const db = seed({ paid: true, jobState: "QUEUED" });
    db.one("orders", { id: ORDER }).amount = 25;
    for (let i = 0; i < 3; i++) {
      await settleBalance(asClient(db), gw.gateway, URLS, ORDER, "cashfree");
    }
    const pending = payments(db).filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(Number(pending[0].amount)).toBe(15);
    expect(gw.calls.create).toHaveLength(1);
  });
});
