import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseRegistrationStore } from "../supabaseRegistrationStore";
import { registerShop, type RegistrationStore } from "../registration";

/**
 * Integration coverage for the Supabase side of registration.
 *
 * The unit tests drive a fake store, so they prove the orchestration but say
 * nothing about whether the adapter's queries are correct — whether
 * `getUserById` returns what we expect, whether the exact-count queries work,
 * or whether deleting a shop really cascades. This exercises the real thing.
 *
 * It writes to the live Supabase project, so it is skipped automatically
 * unless .env.local has a service-role key. Everything it creates is removed
 * again, including on failure.
 */

function loadEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    out[k.trim()] = rest.join("=").trim();
  }
  return out;
}

const env = loadEnv();
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && KEY && !URL.includes("your-project"));

const admin = LIVE
  ? createClient(URL, KEY, { auth: { persistSession: false } })
  : null;

async function makeUser(tag: string) {
  const email = `printq.itest.${tag}.${Date.now()}@example.com`;
  const { data, error } = await admin!.auth.admin.createUser({
    email,
    password: `ITest!${Date.now()}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "could not create test user");
  return { id: data.user.id, email };
}

async function userExists(id: string) {
  const { data, error } = await admin!.auth.admin.getUserById(id);
  return !error && Boolean(data?.user);
}

async function shopCount(userId: string) {
  const { count } = await admin!
    .from("shops")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", userId);
  return count ?? 0;
}

async function cleanup(userId?: string) {
  if (!userId) return;
  const { data } = await admin!.from("shops").select("id").eq("owner_user_id", userId);
  for (const s of data ?? []) await admin!.from("shops").delete().eq("id", s.id);
  await admin!.auth.admin.deleteUser(userId).catch(() => {});
}

describe.skipIf(!LIVE)("registration against live Supabase", () => {
  it("provisions all five rows on success", async () => {
    const user = await makeUser("ok");
    try {
      const store = createSupabaseRegistrationStore(admin!);
      const res = await registerShop(store, {
        userId: user.id,
        shopName: "Integration Test Shop",
        ownerName: "Test Owner",
        phone: "9876543210",
        email: user.email,
        city: "Pune",
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      // Every row the original implementation created must still be created.
      for (const [table, col] of [
        ["shops", "id"],
        ["shop_members", "shop_id"],
        ["pricing", "shop_id"],
        ["shop_settings", "shop_id"],
        ["licences", "shop_id"],
      ] as const) {
        const { count } = await admin!
          .from(table)
          .select(col, { count: "exact", head: true })
          .eq(col, res.shopId);
        expect(`${table}=${count}`).toBe(`${table}=1`);
      }
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);

  it("deletes the auth user and the shop when provisioning fails midway", async () => {
    const user = await makeUser("fail");
    try {
      const real = createSupabaseRegistrationStore(admin!);
      // Force a realistic mid-flight failure, after the shop row exists.
      const failing: RegistrationStore = {
        ...real,
        insertPricing: async () => {
          throw new Error("simulated pricing insert failure");
        },
      };

      const res = await registerShop(failing, {
        userId: user.id,
        shopName: "Rollback Test Shop",
        ownerName: "Test Owner",
        phone: "9876543210",
        email: user.email,
        city: "Pune",
      });

      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.rolledBack).toBe(true);

      // No orphan: the auth user is gone and no shop row survives.
      expect(await userExists(user.id)).toBe(false);
      expect(await shopCount(user.id)).toBe(0);
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);

  it("lets the same email register again after a failed attempt", async () => {
    const first = await makeUser("retry");
    const email = first.email;
    let second: { id: string; email: string } | undefined;
    try {
      const real = createSupabaseRegistrationStore(admin!);
      const failing: RegistrationStore = {
        ...real,
        insertLicence: async () => {
          throw new Error("simulated licence insert failure");
        },
      };
      const payload = {
        shopName: "Retry Test Shop",
        ownerName: "Test Owner",
        phone: "9876543210",
        email,
        city: "Pune",
      };

      const r1 = await registerShop(failing, { ...payload, userId: first.id });
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.rolledBack).toBe(true);

      // Same email, brand new auth user — the retry a real owner would make.
      const { data } = await admin!.auth.admin.createUser({
        email,
        password: `ITest!${Date.now()}`,
        email_confirm: true,
      });
      expect(data?.user).toBeTruthy();
      second = { id: data!.user!.id, email };

      const r2 = await registerShop(real, { ...payload, userId: second.id });
      expect(r2.ok).toBe(true);
    } finally {
      await cleanup(first.id);
      await cleanup(second?.id);
    }
  }, 90_000);

  it("refuses a duplicate and never deletes the established account", async () => {
    const user = await makeUser("dup");
    try {
      const store = createSupabaseRegistrationStore(admin!);
      const payload = {
        userId: user.id,
        shopName: "Duplicate Test Shop",
        ownerName: "Test Owner",
        phone: "9876543210",
        email: user.email,
        city: "Pune",
      };

      const first = await registerShop(store, payload);
      expect(first.ok).toBe(true);

      const second = await registerShop(store, payload);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(409);
      expect(second.rolledBack).toBe(false);

      // The real account and its shop must be untouched.
      expect(await userExists(user.id)).toBe(true);
      expect(await shopCount(user.id)).toBe(1);
    } finally {
      await cleanup(user.id);
    }
  }, 90_000);
});
