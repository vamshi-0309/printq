-- ============================================================
-- 002 · Gateway columns on payments (Cashfree integration)
-- ============================================================
--
-- The payments table already carries gateway, gateway_payment_id and
-- gateway_signature. Two more are needed for a hosted-checkout gateway:
--
--   gateway_order_id     the gateway's own order handle (Cashfree cf_order_id).
--                        We look our order up by our OWN uuid, which is what we
--                        send as Cashfree's order_id, so this is not on the hot
--                        path — it exists for reconciliation against the
--                        gateway's dashboard and settlement reports.
--
--   payment_session_id   the short-lived token the browser checkout SDK needs.
--                        Persisted so a customer who reloads before paying can
--                        be handed the same session instead of a second order.
--
-- Both are nullable: shops on the UPI/manual path never populate them.
-- Safe to run more than once.

alter table payments add column if not exists gateway_order_id text;
alter table payments add column if not exists payment_session_id text;

-- Webhooks arrive keyed by our order id; this is the lookup they perform.
create index if not exists idx_payments_order_id on payments (order_id);

-- Reconciliation lookups by the gateway's own handle.
create index if not exists idx_payments_gateway_order_id
  on payments (gateway_order_id)
  where gateway_order_id is not null;

comment on column payments.gateway_order_id is
  'Gateway-side order handle (e.g. Cashfree cf_order_id), for reconciliation.';
comment on column payments.payment_session_id is
  'Short-lived checkout session token handed to the browser SDK.';
