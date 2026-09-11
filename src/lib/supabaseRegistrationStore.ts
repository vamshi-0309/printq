import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistrationStore, RegistrationInput, ShopRow } from "./registration";

/**
 * Supabase implementation of `RegistrationStore`.
 *
 * Thin by design: every method either succeeds or throws, so the orchestration
 * in `registration.ts` can express the whole flow with try/catch and stays
 * testable against a fake store. Requires a service-role client — provisioning
 * runs before the owner has a shop_members row, so RLS would block it.
 */
export function createSupabaseRegistrationStore(
  supabase: SupabaseClient
): RegistrationStore {
  return {
    async getUser(userId) {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !data?.user) return { exists: false, createdAt: null };
      return { exists: true, createdAt: data.user.created_at ?? null };
    },

    async countShopsOwnedBy(userId) {
      const { count, error } = await supabase
        .from("shops")
        .select("id", { count: "exact", head: true })
        .eq("owner_user_id", userId);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async shopExistsForEmail(email) {
      const { count, error } = await supabase
        .from("shops")
        .select("id", { count: "exact", head: true })
        .eq("email", email);
      if (error) throw new Error(error.message);
      return (count ?? 0) > 0;
    },

    async insertShop(row: RegistrationInput & { slug: string }): Promise<ShopRow> {
      const { data, error } = await supabase
        .from("shops")
        .insert({
          slug: row.slug,
          owner_user_id: row.userId,
          shop_name: row.shopName,
          owner_name: row.ownerName,
          phone: row.phone,
          email: row.email,
          city: row.city,
        })
        .select()
        .single();
      if (error || !data) throw new Error(error?.message ?? "Could not create shop.");
      return { id: data.id, slug: data.slug };
    },

    async insertMember(shopId, userId) {
      const { error } = await supabase
        .from("shop_members")
        .insert({ shop_id: shopId, user_id: userId, role: "owner" });
      if (error) throw new Error(error.message);
    },

    // These three were previously fire-and-forget, so a shop could end up live
    // with no pricing row. They now surface failures and trigger the rollback.
    async insertPricing(shopId) {
      const { error } = await supabase.from("pricing").insert({ shop_id: shopId });
      if (error) throw new Error(error.message);
    },

    async insertSettings(shopId) {
      const { error } = await supabase.from("shop_settings").insert({ shop_id: shopId });
      if (error) throw new Error(error.message);
    },

    async insertLicence(shopId, expiresAt) {
      const { error } = await supabase.from("licences").insert({
        shop_id: shopId,
        plan: "setup_12mo",
        status: "active",
        expires_at: expiresAt,
      });
      if (error) throw new Error(error.message);
    },

    async deleteShop(shopId) {
      const { error } = await supabase.from("shops").delete().eq("id", shopId);
      if (error) throw new Error(error.message);
    },

    async deleteAuthUser(userId) {
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
  };
}
