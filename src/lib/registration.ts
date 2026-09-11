/**
 * Shop registration orchestration.
 *
 * THE PROBLEM THIS SOLVES
 * Registration is two steps that cannot share a transaction: Supabase Auth
 * creates the user, then we provision the shop rows. If provisioning failed,
 * the auth user survived — a login that works but has no shop behind it, and
 * whose email is now taken, so the owner could not simply try again.
 *
 * THE APPROACH
 * Compensating rollback. If provisioning fails we undo everything we created,
 * including the auth user, so the email is free and the owner can retry.
 *
 * WHY THE ROLLBACK IS NARROW
 * /api/register-shop takes a userId from the caller and does not verify a
 * session (it runs before one exists in the email-confirmation flow), so an
 * unrestricted "delete this user" primitive would be a way to delete other
 * people's accounts. `canRollbackUser` therefore permits deletion only for an
 * account that is brand new AND owns nothing — never one that already has a
 * shop, and never one older than the registration window. An established
 * account can never be removed through this path.
 *
 * The store is an interface rather than a Supabase client so this logic can be
 * tested against every failure branch without a live database.
 */

/** How recently the auth user must have been created to be eligible for rollback. */
export const ROLLBACK_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export type RegistrationInput = {
  userId: string;
  shopName: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
};

export type ShopRow = { id: string; slug: string };

export interface RegistrationStore {
  /** Auth user lookup. `createdAt` is an ISO timestamp, or null if unknown. */
  getUser(userId: string): Promise<{ exists: boolean; createdAt: string | null }>;
  /** Number of shops this user already owns. */
  countShopsOwnedBy(userId: string): Promise<number>;
  /** Whether any *other* shop already uses this email. */
  shopExistsForEmail(email: string): Promise<boolean>;

  insertShop(row: RegistrationInput & { slug: string }): Promise<ShopRow>;
  insertMember(shopId: string, userId: string): Promise<void>;
  insertPricing(shopId: string): Promise<void>;
  insertSettings(shopId: string): Promise<void>;
  insertLicence(shopId: string, expiresAt: string): Promise<void>;

  deleteShop(shopId: string): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
}

export type RegistrationResult =
  | { ok: true; shopId: string; slug: string }
  | {
      ok: false;
      status: number;
      error: string;
      /** True when the auth user was removed, so the email is free to reuse. */
      rolledBack: boolean;
    };

/** Slug is the shop name plus a short suffix, so two "Sharma Xerox" don't collide. */
export function slugify(name: string, suffix = Math.random().toString(36).slice(2, 6)) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") +
    "-" +
    suffix
  );
}

/**
 * Whether this auth user may be deleted as part of a failed registration.
 * Deliberately conservative — see the note at the top of the file.
 */
export function canRollbackUser(
  user: { exists: boolean; createdAt: string | null },
  shopsOwned: number,
  now: number = Date.now()
): { allowed: boolean; reason?: string } {
  if (!user.exists) return { allowed: false, reason: "user does not exist" };
  if (shopsOwned > 0) return { allowed: false, reason: "user already owns a shop" };
  if (!user.createdAt) return { allowed: false, reason: "unknown account age" };

  const age = now - new Date(user.createdAt).getTime();
  if (Number.isNaN(age)) return { allowed: false, reason: "unparseable account age" };
  // A negative age (clock skew) is treated as "just created", which is safe:
  // the other two guards still require a brand-new, shop-less account.
  if (age > ROLLBACK_WINDOW_MS) return { allowed: false, reason: "account is not newly created" };

  return { allowed: true };
}

/**
 * Provision a shop, undoing everything (including the auth user) on failure.
 *
 * The success path is unchanged from the original implementation: the same
 * five rows are written, in the same order, with the same defaults.
 */
export async function registerShop(
  store: RegistrationStore,
  input: RegistrationInput,
  opts: { now?: () => number; slugSuffix?: string } = {}
): Promise<RegistrationResult> {
  const now = opts.now ?? (() => Date.now());

  // ---- Pre-flight. Nothing has been created yet, so nothing is rolled back.
  const user = await store.getUser(input.userId);
  if (!user.exists) {
    return { ok: false, status: 400, error: "Unknown user account.", rolledBack: false };
  }

  // Guard the duplicate cases BEFORE touching anything. Critically, an account
  // that already owns a shop is never rolled back — that is someone's real shop.
  const owned = await store.countShopsOwnedBy(input.userId);
  if (owned > 0) {
    return {
      ok: false,
      status: 409,
      error: "This account already has a shop.",
      rolledBack: false,
    };
  }

  if (await store.shopExistsForEmail(input.email)) {
    return {
      ok: false,
      status: 409,
      error: "A shop is already registered with this email address.",
      rolledBack: false,
    };
  }

  // ---- Provisioning. From here on, any failure triggers compensation.
  let shop: ShopRow | null = null;
  try {
    shop = await store.insertShop({
      ...input,
      slug: slugify(input.shopName, opts.slugSuffix),
    });

    await store.insertMember(shop.id, input.userId);
    await store.insertPricing(shop.id);
    await store.insertSettings(shop.id);
    await store.insertLicence(
      shop.id,
      new Date(now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    );

    return { ok: true, shopId: shop.id, slug: shop.slug };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not set up your shop.";

    // Undo the shop first. Cascades clear members/pricing/settings/licences.
    if (shop) {
      try {
        await store.deleteShop(shop.id);
      } catch {
        // Best effort — we still want to free the auth user below.
      }
    }

    const rolledBack = await rollbackUser(store, input.userId, now());

    return { ok: false, status: 500, error: message, rolledBack };
  }
}

/** Delete the just-created auth user, if it is safe to do so. */
async function rollbackUser(
  store: RegistrationStore,
  userId: string,
  now: number
): Promise<boolean> {
  try {
    // Re-read after deleting the shop, so a partially created shop does not
    // make the account look "owned" and block its own cleanup.
    const [user, owned] = await Promise.all([
      store.getUser(userId),
      store.countShopsOwnedBy(userId),
    ]);

    if (!canRollbackUser(user, owned, now).allowed) return false;

    await store.deleteAuthUser(userId);
    return true;
  } catch {
    // Rollback is best-effort: never turn a provisioning failure into a crash.
    return false;
  }
}
