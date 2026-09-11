import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markOrderPaidAndQueue, markOrderPaymentFailed } from "../orderPayment";

/**
 * A gateway can deliver the same webhook twice, and a webhook can race the
 * shop owner tapping "confirm". Either would be a real problem: two tokens for
 * one order, or two queue entries for one job. The fake below models the one
 * thing that prevents it — an UPDATE that only matches rows still `pending`,
 * so exactly one caller wins the swap.
 */

type Order = {
  id: string;
  shop_id: string;
  payment_status: string;
  print_status: string;
  token_number: string | null;
  token_counter: number | null;
  paid_at?: string | null;
  failure_reason?: string | null;
};

function makeFake(order: Order) {
  const state = {
    order: { ...order },
    payments: [
      {
        order_id: order.id,
        status: "pending" as string,
        gateway: null as string | null,
        gateway_payment_id: null as string | null,
      },
    ],
    printJobs: [{ order_id: order.id, state: "CREATED" }],
    queueEntries: [] as { shop_id: string; order_id: string; position: number }[],
    tokenCalls: 0,
  };

  // Each call consumes a counter value, exactly like the Postgres RPC does.
  const nextToken = () => ++state.tokenCalls;

  function from(table: string) {
    const filters: Record<string, unknown> = {};
    let op = "";
    let payload: Record<string, unknown> = {};
    let matched: { id: string }[] = [];
    let applied = false;
    let countMode = false;

    // PostgREST sends the request once, at the terminal call — not on every
    // .eq(). Applying per-filter would re-run the update against state it had
    // already mutated, so the compare-and-swap must be evaluated exactly once
    // with the complete filter set.
    const applyOnce = () => {
      if (applied) return;
      applied = true;

      if (table === "orders" && filters.id === state.order.id) {
        if (
          filters.payment_status !== undefined &&
          state.order.payment_status !== filters.payment_status
        ) {
          matched = [];
          return;
        }
        Object.assign(state.order, payload);
        matched = [{ id: state.order.id }];
        return;
      }
      if (table === "payments") {
        for (const row of state.payments) {
          if (row.order_id !== filters.order_id) continue;
          if (filters.status !== undefined && row.status !== filters.status) continue;
          Object.assign(row, payload);
        }
      }
      if (table === "print_jobs") {
        for (const j of state.printJobs) {
          if (j.order_id === filters.order_id) Object.assign(j, payload);
        }
      }
    };

    const builder = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        // A head/count query filters AFTER select, so it must stay chainable
        // and resolve at await time rather than returning a promise here.
        if (opts?.count === "exact" && opts.head) {
          countMode = true;
          return builder;
        }
        if (op === "update") {
          applyOnce();
          return Promise.resolve({ data: matched, error: null });
        }
        return builder;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      update(next: Record<string, unknown>) {
        op = "update";
        payload = next;
        return builder;
      },
      insert(row: Record<string, unknown>) {
        if (table === "queue_entries") state.queueEntries.push(row as never);
        return Promise.resolve({ data: null, error: null });
      },
      single() {
        // Genuinely unknown ids resolve to null, like PostgREST.
        if (table === "orders") {
          const found = filters.id === state.order.id ? state.order : null;
          return Promise.resolve({ data: found, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle() {
        if (table === "queue_entries") {
          const e = state.queueEntries.find((q) => q.order_id === filters.order_id);
          return Promise.resolve({ data: e ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // Terminal: an update awaited without .select() still executes, and a
      // head/count query resolves to its count.
      then(resolve: (v: Record<string, unknown>) => unknown) {
        if (countMode) {
          const rows = state.queueEntries.filter((q) => q.shop_id === filters.shop_id);
          return Promise.resolve({ count: rows.length, data: null, error: null }).then(resolve);
        }
        if (op === "update") applyOnce();
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return builder;
  }

  const client = {
    from,
    rpc: () => Promise.resolve({ data: nextToken(), error: null }),
  } as unknown as SupabaseClient;

  return { client, state };
}

const BASE: Order = {
  id: "11111111-1111-4111-8111-111111111111",
  shop_id: "22222222-2222-4222-8222-222222222222",
  payment_status: "pending",
  print_status: "payment_pending",
  token_number: null,
  token_counter: null,
};

describe("markOrderPaidAndQueue — first call", () => {
  it("marks paid, assigns a token and queues the job", async () => {
    const { client, state } = makeFake(BASE);
    const res = await markOrderPaidAndQueue(client, BASE.id);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.alreadyPaid).toBe(false);
    expect(res.tokenNumber).toBe("A001");
    expect(res.queuePosition).toBe(1);

    expect(state.order.payment_status).toBe("paid");
    expect(state.order.print_status).toBe("queued");
    expect(state.order.token_number).toBe("A001");
    expect(state.printJobs[0].state).toBe("QUEUED");
    expect(state.queueEntries).toHaveLength(1);
    expect(state.payments[0].status).toBe("paid");
  });

  it("records the gateway payment id when one is supplied", async () => {
    const { client, state } = makeFake(BASE);
    await markOrderPaidAndQueue(client, BASE.id, {
      gatewayPaymentId: "1453002795",
      gateway: "cashfree",
    });
    expect(state.payments[0].gateway_payment_id).toBe("1453002795");
    expect(state.payments[0].gateway).toBe("cashfree");
  });

  it("returns 404 for an order that does not exist", async () => {
    const { client, state } = makeFake(BASE);
    const res = await markOrderPaidAndQueue(client, "99999999-9999-4999-8999-999999999999");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
    // Nothing was touched on the way to deciding that.
    expect(state.tokenCalls).toBe(0);
    expect(state.queueEntries).toHaveLength(0);
  });
});

describe("markOrderPaidAndQueue — idempotency", () => {
  it("a second call does not assign a second token", async () => {
    const { client, state } = makeFake(BASE);

    const first = await markOrderPaidAndQueue(client, BASE.id);
    const second = await markOrderPaidAndQueue(client, BASE.id);

    expect(first.ok && first.alreadyPaid).toBe(false);
    expect(second.ok && second.alreadyPaid).toBe(true);

    // The decisive assertions: one token consumed, one queue entry.
    expect(state.tokenCalls).toBe(1);
    expect(state.queueEntries).toHaveLength(1);
    expect(state.order.token_number).toBe("A001");
    if (second.ok) expect(second.tokenNumber).toBe("A001");
  });

  it("stays idempotent across many duplicate deliveries", async () => {
    const { client, state } = makeFake(BASE);
    for (let i = 0; i < 5; i++) await markOrderPaidAndQueue(client, BASE.id);
    expect(state.tokenCalls).toBe(1);
    expect(state.queueEntries).toHaveLength(1);
  });

  it("reports the original token to the duplicate caller", async () => {
    const { client } = makeFake(BASE);
    await markOrderPaidAndQueue(client, BASE.id);
    const dup = await markOrderPaidAndQueue(client, BASE.id, { gatewayPaymentId: "second" });
    expect(dup.ok && dup.tokenNumber).toBe("A001");
    expect(dup.ok && dup.queuePosition).toBe(1);
  });

  it("never re-queues an order already paid via the manual path", async () => {
    // Owner confirmed first; the gateway webhook arrives afterwards.
    const { client, state } = makeFake({
      ...BASE,
      payment_status: "paid",
      print_status: "queued",
      token_number: "A007",
      token_counter: 7,
    });
    const res = await markOrderPaidAndQueue(client, BASE.id, { gateway: "cashfree" });
    expect(res.ok && res.alreadyPaid).toBe(true);
    expect(state.tokenCalls).toBe(0);
    expect(state.queueEntries).toHaveLength(0);
    expect(state.order.token_number).toBe("A007");
  });
});

describe("markOrderPaymentFailed", () => {
  it("marks a pending order failed without queueing it", async () => {
    const { client, state } = makeFake(BASE);
    await markOrderPaymentFailed(client, BASE.id, "Payment USER_DROPPED");

    expect(state.order.payment_status).toBe("failed");
    expect(state.order.failure_reason).toBe("Payment USER_DROPPED");
    expect(state.printJobs[0].state).toBe("CREATED");
    expect(state.queueEntries).toHaveLength(0);
  });

  // A late failure webhook for an earlier attempt must not undo a success.
  it("does not downgrade an order that already succeeded", async () => {
    const { client, state } = makeFake(BASE);
    await markOrderPaidAndQueue(client, BASE.id);
    await markOrderPaymentFailed(client, BASE.id, "Payment FAILED");

    expect(state.order.payment_status).toBe("paid");
    expect(state.payments[0].status).toBe("paid");
  });
});
