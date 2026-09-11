-- ============================================================
-- 003 · Agent pairing code storage
-- ============================================================
--
-- SYMPTOM
--   "Generate pairing code" in Dashboard -> Settings returned
--   500 {"error":"Failed to save pairing code."}, so an agent could never be
--   paired and every shop stayed OFFLINE on its customer page.
--
-- CAUSE
--   /api/shop/pairing-code writes shop_settings.pairing_code, and
--   /api/agent/pair reads it, but the column was never added to the schema.
--   The write failed, the route surfaced a 500, and pairing was impossible.
--
-- Also adds the expiry the pairing route's own comment describes ("the agent
-- sends it here within 10 minutes") but which had nowhere to be stored, so
-- codes previously lived forever until consumed.
--
-- Safe to run more than once.

alter table shop_settings add column if not exists pairing_code text;
alter table shop_settings add column if not exists pairing_code_expires_at timestamptz;

-- /api/agent/pair looks a shop up by this code, and it must be unique so a
-- collision can never pair an agent to the wrong shop. Partial, because the
-- column is NULL for every shop that isn't mid-pairing.
create unique index if not exists idx_shop_settings_pairing_code
  on shop_settings (pairing_code)
  where pairing_code is not null;

comment on column shop_settings.pairing_code is
  'Short-lived 6-character code an agent exchanges for credentials. Cleared on use.';
comment on column shop_settings.pairing_code_expires_at is
  'When the pairing code stops being accepted (AGENT_PAIRING_TOKEN_TTL_MINUTES).';
