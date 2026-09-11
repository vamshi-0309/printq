/**
 * Payment-gateway settings helpers.
 *
 * Phase note: Cashfree currently runs on PrintQ's single platform merchant
 * account (CASHFREE_APP_ID / CASHFREE_SECRET_KEY on the server), so a shop has
 * nothing to supply. `payment_gateway_account_id` is retained in the schema
 * for the later per-shop sub-merchant phase, where each shop settles directly.
 *
 * Because that column is currently unused, how "blank" is stored matters: it
 * must be NULL, never "". An empty string would later be indistinguishable
 * from a value that was deliberately cleared, and would make a
 * `where payment_gateway_account_id is null` backfill silently miss rows.
 */

export function normalizeGatewayAccountId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
