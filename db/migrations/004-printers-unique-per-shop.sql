-- ============================================================
-- 004 · One row per printer per shop
-- ============================================================
--
-- SYMPTOM
--   The agent heartbeats successfully and reports its printers, but the
--   dashboard's Printers page stays empty forever and no printer can be
--   chosen as the default.
--
-- CAUSE
--   /api/agent/heartbeat upserts with onConflict "shop_id,system_name", but
--   no unique constraint matched that specification, so Postgres rejected
--   every upsert with:
--     "there is no unique or exclusion constraint matching the ON CONFLICT
--      specification"
--   The route never inspected the error, so the heartbeat returned 200 while
--   silently discarding every printer.
--
-- Deduplicate defensively before adding the constraint: the upsert never
-- succeeded, so duplicates are unlikely, but plain inserts elsewhere could
-- have created them and the index would then fail to build.
--
-- Safe to run more than once.

delete from printers p
using printers q
where p.shop_id = q.shop_id
  and p.system_name = q.system_name
  and p.ctid > q.ctid;

create unique index if not exists idx_printers_shop_system_name
  on printers (shop_id, system_name);

comment on index idx_printers_shop_system_name is
  'Backs the agent heartbeat upsert (on_conflict=shop_id,system_name).';
