import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { FakeDb, asClient } from "@/lib/__tests__/fakeSupabase";
import { computeCashfreeSignature } from "@/lib/cashfreeWebhook";
import { CUSTOMER_STATUS_KEYS } from "@/lib/customerStatus";

/**
 * The customer's side, through the real route handlers: placing an order,
 * paying, watching the queue — and the owner's switches and approval mode.
 */

let db: FakeDb;
let pdfBytes: Uint8Array;
const cashfreeCalls: { create: { id: string; amount: number }[] } = { create: [] };
const deleted: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => asClient(db),
}));

vi.mock("@/lib/storage", () => ({
  getSignedDownloadUrl: async () => "https://storage.test/signed",
  downloadFile: async () => pdfBytes,
  deleteFile: async (path: string) => {
    deleted.push(path);
  },
  StorageObjectMissing: class extends Error {},
}));

vi.mock("@/lib/cashfree", () => {
  class CashfreeError extends Error {}
  return {
    CashfreeError,
    getCashfreeConfig: () => ({ appId: "test", secretKey: "test", baseUrl: "https://cf.test", apiVersion: "2023-08-01" }),
    createCashfreeOrder: async (input: { orderUuid: string; cashfreeOrderId?: string; amount: number }) => {
      const id = input.cashfreeOrderId ?? input.orderUuid;
      cashfreeCalls.create.push({ id, amount: input.amount });
      return { paymentSessionId: `session_${id}`, cfOrderId: `cf_${id}`, orderId: id };
    },
    refundCashfreeOrder: async (input: { refundId: string }) => ({ refundId: input.refundId, cfRefundId: "r", status: "PENDING" }),
    terminateCashfreeOrder: async () => true,
    refundIdFor: (id: string, n: number) => `${id.replace(/-/g, "").slice(0, 34)}rf${n}`,
  };
});

const OWNER = "0wner000-0000-4000-8000-000000000001";
let shopUnderTest = "";
vi.mock("@/lib/shopAuth", () => ({
  requireShop: async () => ({
    ok: true,
    ctx: { userId: OWNER, shopId: shopUnderTest, role: "owner", db: asClient(db) },
  }),
}));

const { POST: placeOrder } = await import("@/app/api/orders/route");
const { POST: orderStatus } = await import("@/app/api/orders/status/route");
const { POST: payNow } = await import("@/app/api/orders/pay/route");
const { POST: webhook } = await import("@/app/api/payments/cashfree/webhook/route");
const { POST: ownerAction } = await import("@/app/api/shop/orders/[orderId]/action/route");
const { POST: claim } = await import("@/app/api/agent/jobs/claim/route");

vi.mock("@/app/api/agent/auth", () => ({
  authenticateAgent: async () => ({ ok: true, shopId: shopUnderTest, agentId: "agent-1" }),
}));

const SHOP = "5a0b0000-0000-4000-8000-0000000000a1";
const SECRET = "whsec_test_only";

beforeAll(async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 10; i++) doc.addPage([595, 842]);
  pdfBytes = await doc.save();
  process.env.CASHFREE_SECRET_KEY = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = "https://printq.test";
});

let tokenCounter = 0;
let rateHits: Map<string, number>;

function seedShop(opts: { gateway?: string | null; mode?: string; open?: boolean; accepting?: boolean } = {}) {
  tokenCounter = 0;
  rateHits = new Map();
  cashfreeCalls.create = [];
  deleted.length = 0;
  shopUnderTest = SHOP;
  let publicSeq = 300;
  db = new FakeDb(
    {
      shops: [{ id: SHOP, shop_name: "Test Xerox", status: "active", slug: "test-xerox" }],
      shop_settings: [
        {
          shop_id: SHOP,
          upi_id: "testxerox@okhdfc",
          payment_gateway: opts.gateway === undefined ? "cashfree" : opts.gateway,
          shop_open: opts.open ?? true,
          accepting_orders: opts.accepting ?? true,
          printing_mode: opts.mode ?? "automatic",
          file_retention_hours: 24,
        },
      ],
      pricing: [
        {
          shop_id: SHOP,
          a4_bw_per_page: 2,
          a4_color_per_page: 10,
          a3_bw_per_page: 4,
          a3_color_per_page: 20,
          duplex_discount_percent: 0,
          minimum_order_amount: 0,
          enabled_paper_sizes: ["A4", "A3"],
        },
      ],
      printers: [
        {
          id: "printer-1",
          shop_id: SHOP,
          agent_id: "agent-1",
          system_name: "HP",
          display_name: "Counter",
          is_default: true,
          is_enabled: true,
          supports_duplex: false,
          last_status: "ready",
        },
      ],
      audit_logs: [],
      print_attempts: [],
      queue_entries: [],
    },
    {
      rpc: {
        get_next_token: () => ++tokenCounter,
        hit_rate_limit: (args) => {
          const key = String(args.p_key);
          const n = (rateHits.get(key) ?? 0) + 1;
          rateHits.set(key, n);
          return n <= Number(args.p_limit);
        },
      },
      defaults: {
        orders: () => ({
          public_order_id: `PQ${++publicSeq}`,
          customer_session_token: randomUUID(),
          token_number: null,
          paid_at: null,
          completed_at: null,
          print_started_at: null,
          failure_reason: null,
          printer_id: null,
        }),
        payments: () => ({ payment_session_id: null, refund_status: null, refund_amount: null, refund_id: null }),
        order_files: () => ({ deleted_at: null, converted_storage_path: null }),
      },
    }
  );
}

const orderBody = (over: Record<string, unknown> = {}) => ({
  shopId: SHOP,
  fileStoragePath: `${SHOP}/1789-abc/notes.pdf`,
  originalFilename: "notes.pdf",
  copies: 1,
  colorMode: "bw",
  paperSize: "A4",
  orientation: "auto",
  sides: "single",
  pageRange: "all",
  ...over,
});

const post = (handler: (r: NextRequest) => Promise<Response>, url: string, body: unknown, ip = "203.0.113.7") =>
  handler(
    new NextRequest(`http://t${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    })
  );

const status = async (order: { orderUuid: string; customerSessionToken: string }) => {
  const res = await post(orderStatus, "/api/orders/status", {
    orderId: order.orderUuid,
    customerSessionToken: order.customerSessionToken,
  });
  return { res, body: await res.json() };
};

const act = async (orderId: string, body: Record<string, unknown>) => {
  const res = await ownerAction(
    new NextRequest(`http://t/api/shop/orders/${orderId}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ orderId }) }
  );
  return { res, body: await res.json() };
};

async function deliverWebhook(cashfreeOrderId: string, amount: number, paymentId = "cfpay_1") {
  const raw = JSON.stringify({
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: {
      order: { order_id: cashfreeOrderId, order_amount: amount },
      payment: { cf_payment_id: paymentId, payment_status: "SUCCESS" },
    },
  });
  const ts = String(Date.now());
  return webhook(
    new NextRequest("http://t/api/payments/cashfree/webhook", {
      method: "POST",
      headers: { "x-webhook-signature": computeCashfreeSignature(raw, ts, SECRET), "x-webhook-timestamp": ts },
      body: raw,
    })
  );
}

const claimJob = () =>
  claim(new NextRequest("http://t/api/agent/jobs/claim", { method: "POST" }));

/* ─────────────────────────────────────────────────────────────── */

describe("automatic mode is unchanged", () => {
  beforeEach(() => seedShop());

  it("creates a payable order with a Cashfree session under the order's own id", async () => {
    const res = await post(placeOrder, "/api/orders", orderBody());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.amount).toBe(20); // 10 pages × ₹2
    expect(body.paymentSessionId).toBe(`session_${body.orderUuid}`);
    expect(db.one("orders", { id: body.orderUuid }).print_status).toBe("payment_pending");
    expect(db.one("print_jobs", { order_id: body.orderUuid }).state).toBe("CREATED");
    expect(db.one("payments", { order_id: body.orderUuid }).cashfree_order_id).toBe(body.orderUuid);
  });

  it("a verified payment queues it and the agent can claim it", async () => {
    const order = await (await post(placeOrder, "/api/orders", orderBody())).json();
    await deliverWebhook(order.orderUuid, 20);
    expect(db.one("print_jobs", { order_id: order.orderUuid }).state).toBe("QUEUED");
    expect((await claimJob()).status).toBe(200);
  });
});

describe("idempotency", () => {
  beforeEach(() => seedShop({ gateway: null }));

  it("a double-tapped Pay creates one order", async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([
      post(placeOrder, "/api/orders", orderBody({ idempotencyKey: key })),
      post(placeOrder, "/api/orders", orderBody({ idempotencyKey: key })),
    ]);
    const [ja, jb] = [await a.json(), await b.json()];
    expect(ja.orderUuid).toBe(jb.orderUuid);
    expect(db.rows("orders")).toHaveLength(1);
    expect(db.rows("payments")).toHaveLength(1);
    expect(db.rows("print_jobs")).toHaveLength(1);
  });

  it("Back then Pay again returns the same order", async () => {
    const key = randomUUID();
    const first = await (await post(placeOrder, "/api/orders", orderBody({ idempotencyKey: key }))).json();
    const again = await (await post(placeOrder, "/api/orders", orderBody({ idempotencyKey: key }))).json();
    expect(again.orderUuid).toBe(first.orderUuid);
    expect(again.customerSessionToken).toBe(first.customerSessionToken);
    expect(again.duplicate).toBe(true);
    expect(db.rows("orders")).toHaveLength(1);
  });

  it("a new checkout attempt (new key) is a new order", async () => {
    await post(placeOrder, "/api/orders", orderBody({ idempotencyKey: randomUUID() }));
    await post(placeOrder, "/api/orders", orderBody({ idempotencyKey: randomUUID() }));
    expect(db.rows("orders")).toHaveLength(2);
  });

  it("a duplicate payment webhook issues one token and one queue place", async () => {
    seedShop();
    const order = await (await post(placeOrder, "/api/orders", orderBody())).json();
    const r1 = await (await deliverWebhook(order.orderUuid, 20)).json();
    const r2 = await (await deliverWebhook(order.orderUuid, 20)).json();
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);
    expect(tokenCounter).toBe(1);
    expect(db.rows("queue_entries")).toHaveLength(1);
  });
});

describe("rate limiting", () => {
  beforeEach(() => seedShop({ gateway: null }));

  it("returns 429 with the agreed message after the limit", async () => {
    const statuses: number[] = [];
    let last: { error?: string } = {};
    for (let i = 0; i < 11; i++) {
      const res = await post(placeOrder, "/api/orders", orderBody());
      statuses.push(res.status);
      last = await res.json();
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(last.error).toBe("Too many uploads, please wait a moment");
    expect(db.rows("orders")).toHaveLength(10);
  });

  it("counts each address separately", async () => {
    for (let i = 0; i < 10; i++) await post(placeOrder, "/api/orders", orderBody(), "203.0.113.7");
    const other = await post(placeOrder, "/api/orders", orderBody(), "198.51.100.9");
    expect(other.status).toBe(200);
  });

  it("does not store the caller's IP address", async () => {
    await post(placeOrder, "/api/orders", orderBody(), "203.0.113.7");
    expect([...rateHits.keys()].join()).not.toContain("203.0.113.7");
  });

  it("fails open if the counter is unavailable", async () => {
    db.rpcHandlers.hit_rate_limit = () => {
      throw new Error("function missing");
    };
    expect((await post(placeOrder, "/api/orders", orderBody())).status).toBe(200);
  });
});

describe("shop open / accepting switches", () => {
  it("a closed shop refuses orders server-side whatever the page showed", async () => {
    seedShop({ open: false });
    const res = await post(placeOrder, "/api/orders", orderBody());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("This shop is currently closed. Please try again later.");
    expect(db.rows("orders")).toHaveLength(0);
  });

  it("a paused shop refuses orders with the paused message", async () => {
    seedShop({ accepting: false });
    const res = await post(placeOrder, "/api/orders", orderBody());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Not accepting new print orders right now");
  });

  it("refuses double-sided when the chosen printer can't do it", async () => {
    seedShop();
    const res = await post(placeOrder, "/api/orders", orderBody({ sides: "double" }));
    expect(res.status).toBe(422);
  });
});

describe("approval mode, end to end", () => {
  beforeEach(() => seedShop({ mode: "approval_required" }));

  it("approve → pay → queued → claimable", async () => {
    const order = await (await post(placeOrder, "/api/orders", orderBody())).json();
    expect(order.status).toBe("pending_approval");
    expect(order.paymentSessionId).toBeNull();
    expect(cashfreeCalls.create).toHaveLength(0);
    expect(db.one("print_jobs", { order_id: order.orderUuid }).state).toBe("PENDING_APPROVAL");

    // Nothing to pay and nothing to print yet.
    expect((await status(order)).body.payment).toBeNull();
    expect((await post(payNow, "/api/orders/pay", { orderId: order.orderUuid, customerSessionToken: order.customerSessionToken })).status).toBe(409);
    expect((await claimJob()).status).toBe(204);
    expect((await act(order.orderUuid, { action: "confirm_payment" })).res.status).toBe(409);

    // Owner approves: the checkout is created at the approved price.
    const approved = await act(order.orderUuid, { action: "approve" });
    expect(approved.res.status).toBe(200);
    expect(db.one("orders", { id: order.orderUuid }).print_status).toBe("payment_pending");
    expect(cashfreeCalls.create).toEqual([{ id: order.orderUuid, amount: 20 }]);

    // The customer's page now offers Pay now.
    const s = (await status(order)).body;
    expect(s.payment).toMatchObject({ kind: "order", amount: 20, paymentSessionId: `session_${order.orderUuid}` });

    await deliverWebhook(order.orderUuid, 20);
    expect(db.one("orders", { id: order.orderUuid }).payment_status).toBe("paid");
    expect((await claimJob()).status).toBe(200);
  });

  it("reject → terminal, reason shown, file deleted, nothing payable", async () => {
    const order = await (await post(placeOrder, "/api/orders", orderBody())).json();

    expect((await act(order.orderUuid, { action: "reject" })).res.status).toBe(422); // reason required
    const rejected = await act(order.orderUuid, { action: "reject", reason: "File is blurry, please re-scan" });
    expect(rejected.res.status).toBe(200);

    expect(db.one("orders", { id: order.orderUuid }).print_status).toBe("rejected");
    expect(db.one("print_jobs", { order_id: order.orderUuid }).state).toBe("REJECTED");
    expect(deleted).toEqual([`${SHOP}/1789-abc/notes.pdf`]);
    expect(db.one("order_files", { order_id: order.orderUuid }).deleted_at).toBeTruthy();

    const s = (await status(order)).body;
    expect(s.printStatus).toBe("rejected");
    expect(s.rejectionReason).toBe("File is blurry, please re-scan");
    expect(s.payment).toBeNull();

    // Terminal: cannot be approved afterwards.
    expect((await act(order.orderUuid, { action: "approve" })).res.status).toBe(409);
  });
});

describe("top-up after an owner raises a paid order's price", () => {
  it("is not claimable until the difference is paid, then is", async () => {
    seedShop();
    const order = await (await post(placeOrder, "/api/orders", orderBody())).json();
    await deliverWebhook(order.orderUuid, 20);

    const edited = await act(order.orderUuid, { action: "edit", changes: { copies: 2 } });
    expect(edited.body.outcome).toBe("topup");
    expect(db.one("print_jobs", { order_id: order.orderUuid }).state).toBe("AWAITING_TOPUP");
    expect((await claimJob()).status).toBe(204);

    const s = (await status(order)).body;
    expect(s.payment).toMatchObject({ kind: "topup", amount: 20 });
    expect(s.amount).toBe(40);
    expect(s.amountPaid).toBe(20);

    await deliverWebhook(`${order.orderUuid}-t1`, 20, "cfpay_topup");
    expect(db.one("print_jobs", { order_id: order.orderUuid }).state).toBe("QUEUED");
    expect((await claimJob()).status).toBe(200);
  });
});

describe("what a customer can see", () => {
  beforeEach(() => seedShop({ gateway: null }));

  async function paidOrder() {
    const o = await (await post(placeOrder, "/api/orders", orderBody({ idempotencyKey: randomUUID() }))).json();
    await act(o.orderUuid, { action: "confirm_payment" });
    return o;
  }

  it("returns exactly the allowed fields and nothing about other customers", async () => {
    const first = await paidOrder();
    const second = await paidOrder();
    const mine = await paidOrder();

    // The first order is at the printer.
    db.one("print_jobs", { order_id: first.orderUuid }).state = "PRINT_ATTEMPTED";
    db.one("orders", { id: first.orderUuid }).print_status = "print_attempted";
    db.one("orders", { id: first.orderUuid }).print_started_at = new Date().toISOString();

    const { body } = await status(mine);
    expect(Object.keys(body).sort()).toEqual([...CUSTOMER_STATUS_KEYS].sort());

    expect(body.queuePosition).toBe(3);
    expect(body.currentlyPrinting).toBe(db.one("orders", { id: first.orderUuid }).token_number);
    expect(body.estimatedWaitMinutes).toBeGreaterThan(0);

    // Nothing about the other two orders except that one token.
    const text = JSON.stringify(body);
    for (const other of [first, second]) {
      expect(text).not.toContain(other.orderUuid);
      expect(text).not.toContain(other.orderId);
      expect(text).not.toContain(other.customerSessionToken);
    }
    expect(text).not.toContain(db.one("orders", { id: second.orderUuid }).token_number);
    expect(text).not.toContain("storage");
    expect(text).not.toContain(SHOP);
  });

  it("someone else's session token gets nothing", async () => {
    const mine = await paidOrder();
    const res = await post(orderStatus, "/api/orders/status", {
      orderId: mine.orderUuid,
      customerSessionToken: randomUUID(),
    });
    expect(res.status).toBe(404);
  });

  it("a finished order's link expires after a day", async () => {
    const o = await paidOrder();
    const row = db.one("orders", { id: o.orderUuid });
    row.print_status = "completed";
    row.completed_at = new Date(Date.now() - 25 * 3600_000).toISOString();
    const { res, body } = await status(o);
    expect(res.status).toBe(410);
    expect(body.expired).toBe(true);
    expect(Object.keys(body).sort()).toEqual(["error", "expired", "orderId"]);
  });

  it("an unpaid order whose file retention removed expires", async () => {
    const o = await (await post(placeOrder, "/api/orders", orderBody())).json();
    db.one("order_files", { order_id: o.orderUuid }).deleted_at = new Date().toISOString();
    expect((await status(o)).res.status).toBe(410);
  });
});
