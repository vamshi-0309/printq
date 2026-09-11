import { describe, it, expect } from "vitest";
import {
  registerShop,
  canRollbackUser,
  slugify,
  ROLLBACK_WINDOW_MS,
  type RegistrationStore,
} from "../registration";

/**
 * These cover the orphaned-user flaw: a failure after the Supabase Auth user
 * exists used to leave a login with no shop, and an email that could not be
 * reused. The store is faked so every failure branch is reachable without a
 * live database.
 */

const NOW = new Date("2026-09-06T12:00:00Z").getTime();
const now = () => NOW;

const INPUT = {
  userId: "11111111-1111-4111-8111-111111111111",
  shopName: "Sharma Xerox",
  ownerName: "Anil Sharma",
  phone: "9876543210",
  email: "shop@example.com",
  city: "Pune",
};

type Calls = string[];

/** In-memory store. `failOn` makes one named step throw. */
function makeStore(
  opts: {
    failOn?: keyof RegistrationStore;
    userExists?: boolean;
    createdAt?: string | null;
    shopsOwned?: number;
    emailTaken?: boolean;
    deleteUserThrows?: boolean;
  } = {}
) {
  const calls: Calls = [];
  const state = {
    shopsOwned: opts.shopsOwned ?? 0,
    userDeleted: false,
    shopsCreated: [] as string[],
    shopsDeleted: [] as string[],
  };

  const guard = (name: keyof RegistrationStore) => {
    calls.push(name);
    if (opts.failOn === name) throw new Error(`${name} failed`);
  };

  const store: RegistrationStore = {
    async getUser() {
      calls.push("getUser");
      return {
        exists: opts.userExists ?? true,
        createdAt:
          opts.createdAt === undefined ? new Date(NOW - 5_000).toISOString() : opts.createdAt,
      };
    },
    async countShopsOwnedBy() {
      calls.push("countShopsOwnedBy");
      return state.shopsOwned;
    },
    async shopExistsForEmail() {
      calls.push("shopExistsForEmail");
      return opts.emailTaken ?? false;
    },
    async insertShop(row) {
      guard("insertShop");
      state.shopsCreated.push(row.slug);
      state.shopsOwned += 1; // a created shop makes the user look "owning"
      return { id: "shop-1", slug: row.slug };
    },
    async insertMember() {
      guard("insertMember");
    },
    async insertPricing() {
      guard("insertPricing");
    },
    async insertSettings() {
      guard("insertSettings");
    },
    async insertLicence() {
      guard("insertLicence");
    },
    async deleteShop(id) {
      calls.push("deleteShop");
      state.shopsDeleted.push(id);
      state.shopsOwned = Math.max(0, state.shopsOwned - 1);
    },
    async deleteAuthUser() {
      calls.push("deleteAuthUser");
      if (opts.deleteUserThrows) throw new Error("admin API down");
      state.userDeleted = true;
    },
  };

  return { store, calls, state };
}

/* ── 1. Successful registration ──────────────────────────────────── */

describe("registerShop — success", () => {
  it("provisions all five rows and returns the shop", async () => {
    const { store, calls, state } = makeStore();
    const res = await registerShop(store, INPUT, { now, slugSuffix: "ab12" });

    expect(res).toEqual({ ok: true, shopId: "shop-1", slug: "sharma-xerox-ab12" });
    expect(calls).toEqual(
      expect.arrayContaining([
        "insertShop",
        "insertMember",
        "insertPricing",
        "insertSettings",
        "insertLicence",
      ])
    );
    // Unchanged success behaviour: nothing is deleted, nothing rolled back.
    expect(calls).not.toContain("deleteShop");
    expect(calls).not.toContain("deleteAuthUser");
    expect(state.userDeleted).toBe(false);
  });

  it("writes the rows in the original order", async () => {
    const { store, calls } = makeStore();
    await registerShop(store, INPUT, { now, slugSuffix: "ab12" });
    const writes = calls.filter((c) => c.startsWith("insert"));
    expect(writes).toEqual([
      "insertShop",
      "insertMember",
      "insertPricing",
      "insertSettings",
      "insertLicence",
    ]);
  });

  it("gives the licence a 12-month expiry", async () => {
    let captured = "";
    const { store } = makeStore();
    store.insertLicence = async (_id, expiresAt) => {
      captured = expiresAt;
    };
    await registerShop(store, INPUT, { now });
    expect(new Date(captured).getTime()).toBe(NOW + 365 * 24 * 60 * 60 * 1000);
  });
});

/* ── 2. Shop provisioning failure ────────────────────────────────── */

describe("registerShop — provisioning failure", () => {
  // Every step after the auth user exists must clean up after itself.
  const steps = [
    "insertShop",
    "insertMember",
    "insertPricing",
    "insertSettings",
    "insertLicence",
  ] as const;

  for (const step of steps) {
    it(`rolls the auth user back when ${step} fails`, async () => {
      const { store, calls, state } = makeStore({ failOn: step });
      const res = await registerShop(store, INPUT, { now });

      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.status).toBe(500);
      expect(res.error).toContain(step);
      expect(res.rolledBack).toBe(true);
      expect(state.userDeleted).toBe(true);
      expect(calls).toContain("deleteAuthUser");
    });
  }

  it("deletes the partially created shop before the auth user", async () => {
    const { store, calls, state } = makeStore({ failOn: "insertPricing" });
    await registerShop(store, INPUT, { now });

    expect(state.shopsDeleted).toEqual(["shop-1"]);
    expect(calls.indexOf("deleteShop")).toBeLessThan(calls.indexOf("deleteAuthUser"));
  });

  it("does not create a shop when the very first insert fails", async () => {
    const { store, state } = makeStore({ failOn: "insertShop" });
    await registerShop(store, INPUT, { now });
    expect(state.shopsDeleted).toEqual([]);
    expect(state.userDeleted).toBe(true);
  });

  it("reports rolledBack:false if deleting the auth user itself fails", async () => {
    // The orphan survives, but the request must still fail cleanly, not throw.
    const { store } = makeStore({ failOn: "insertMember", deleteUserThrows: true });
    const res = await registerShop(store, INPUT, { now });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.rolledBack).toBe(false);
    expect(res.status).toBe(500);
  });

  it("rejects an unknown user without deleting anything", async () => {
    const { store, calls } = makeStore({ userExists: false });
    const res = await registerShop(store, INPUT, { now });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.rolledBack).toBe(false);
    expect(calls).not.toContain("deleteAuthUser");
  });
});

/* ── 3. Duplicate email ──────────────────────────────────────────── */

describe("registerShop — duplicates", () => {
  it("rejects a user who already owns a shop", async () => {
    const { store } = makeStore({ shopsOwned: 1 });
    const res = await registerShop(store, INPUT, { now });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.error).toMatch(/already has a shop/i);
  });

  // The important half: a duplicate must never delete the existing account.
  it("never rolls back an account that already owns a shop", async () => {
    const { store, calls, state } = makeStore({ shopsOwned: 1 });
    const res = await registerShop(store, INPUT, { now });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.rolledBack).toBe(false);
    expect(state.userDeleted).toBe(false);
    expect(calls).not.toContain("deleteAuthUser");
    expect(calls).not.toContain("insertShop");
  });

  it("rejects an email already used by another shop", async () => {
    const { store, state } = makeStore({ emailTaken: true });
    const res = await registerShop(store, INPUT, { now });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.error).toMatch(/already registered with this email/i);
    expect(state.userDeleted).toBe(false);
  });

  it("checks duplicates before creating anything", async () => {
    const { store, calls } = makeStore({ emailTaken: true });
    await registerShop(store, INPUT, { now });
    expect(calls).not.toContain("insertShop");
  });
});

/* ── 4. Retry after a failed registration ────────────────────────── */

describe("registerShop — retry after failure", () => {
  it("a second attempt succeeds once the first was rolled back", async () => {
    // First attempt: provisioning dies, everything is undone.
    const first = makeStore({ failOn: "insertLicence" });
    const r1 = await registerShop(first.store, INPUT, { now });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.rolledBack).toBe(true);
    expect(first.state.userDeleted).toBe(true);
    expect(first.state.shopsDeleted).toEqual(["shop-1"]);

    // Retry with the same email — nothing is left blocking it.
    const second = makeStore();
    const r2 = await registerShop(second.store, INPUT, { now, slugSuffix: "cd34" });
    expect(r2).toEqual({ ok: true, shopId: "shop-1", slug: "sharma-xerox-cd34" });
  });

  it("leaves the email free after rollback", async () => {
    const { store, state } = makeStore({ failOn: "insertMember" });
    await registerShop(store, INPUT, { now });
    // No shop row survives, so shopExistsForEmail would be false on retry.
    expect(state.shopsCreated.length - state.shopsDeleted.length).toBe(0);
    expect(state.userDeleted).toBe(true);
  });
});

/* ── Rollback safety rules ───────────────────────────────────────── */

describe("canRollbackUser", () => {
  const fresh = { exists: true, createdAt: new Date(NOW - 1000).toISOString() };

  it("allows a brand-new account that owns nothing", () => {
    expect(canRollbackUser(fresh, 0, NOW).allowed).toBe(true);
  });

  it("refuses an account that owns a shop", () => {
    expect(canRollbackUser(fresh, 1, NOW)).toEqual({
      allowed: false,
      reason: "user already owns a shop",
    });
  });

  it("refuses an account older than the rollback window", () => {
    const old = { exists: true, createdAt: new Date(NOW - ROLLBACK_WINDOW_MS - 1).toISOString() };
    expect(canRollbackUser(old, 0, NOW).allowed).toBe(false);
  });

  it("allows an account right at the window edge", () => {
    const edge = { exists: true, createdAt: new Date(NOW - ROLLBACK_WINDOW_MS).toISOString() };
    expect(canRollbackUser(edge, 0, NOW).allowed).toBe(true);
  });

  it("refuses when the account does not exist", () => {
    expect(canRollbackUser({ exists: false, createdAt: null }, 0, NOW).allowed).toBe(false);
  });

  it("refuses when the account age is unknown or unparseable", () => {
    expect(canRollbackUser({ exists: true, createdAt: null }, 0, NOW).allowed).toBe(false);
    expect(canRollbackUser({ exists: true, createdAt: "not-a-date" }, 0, NOW).allowed).toBe(false);
  });
});

describe("slugify", () => {
  it("lowercases, dashes and suffixes the shop name", () => {
    expect(slugify("Sharma Xerox & Stationery", "ab12")).toBe("sharma-xerox-stationery-ab12");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  !!Copy Point!!  ", "zz99")).toBe("copy-point-zz99");
  });
});
