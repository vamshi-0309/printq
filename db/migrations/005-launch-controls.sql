-- ============================================================
-- 005 · Launch controls: shop status, approval mode, price
--       reconciliation, per-range colour, rate limiting
-- ============================================================
--
-- Additive, with ONE exception called out below: the orders.print_status
-- CHECK constraint is replaced, because the approval and top-up flows need
-- three new order states. The replacement keeps every existing value, so no
-- current row can violate it.
--
-- Safe to run more than once.
--
-- Run in the Supabase SQL editor, then reply "applied".

begin;

-- ------------------------------------------------------------
-- Part 1 · Shop open/closed, accepting/paused, printing mode
-- ------------------------------------------------------------
-- On shop_settings rather than shops: shops.status is the licence/admin
-- state (active/suspended/expired) that the shop owner does not control.
-- These are the owner's own day-to-day switches.

alter table shop_settings
  add column if not exists shop_open boolean not null default true,
  add column if not exists accepting_orders boolean not null default true,
  add column if not exists printing_mode text not null default 'automatic';

alter table shop_settings drop constraint if exists shop_settings_printing_mode_check;
alter table shop_settings add constraint shop_settings_printing_mode_check
  check (printing_mode in ('automatic', 'approval_required'));

comment on column shop_settings.shop_open is
  'Owner switch. False: the customer page shows "closed" and hides the upload flow.';
comment on column shop_settings.accepting_orders is
  'Owner switch. False while open: customers may browse and preview but not submit.';
comment on column shop_settings.printing_mode is
  'automatic: paid jobs print. approval_required: owner approves before the customer can pay.';

-- ------------------------------------------------------------
-- Order states  ·  THE ONE NON-ADDITIVE CHANGE
-- ------------------------------------------------------------
--   pending_approval  approval-mode order waiting for the owner; no payment yet
--   rejected          owner declined it; terminal; no payment ever taken
--   awaiting_topup    paid, then edited to a higher price; not claimable
--                     until the difference is paid

-- Drop whatever CHECK currently guards print_status, whatever it was named,
-- so a differently-named production constraint can't silently survive and
-- keep rejecting the new values.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.orders'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%print_status%'
  loop
    execute format('alter table orders drop constraint %I', c.conname);
  end loop;
end $$;

alter table orders add constraint orders_print_status_check
  check (print_status in (
    'created', 'payment_pending', 'paid', 'queued', 'claimed',
    'print_attempted', 'printing', 'completed', 'failed', 'cancelled', 'held',
    'pending_approval', 'rejected', 'awaiting_topup'
  ));

-- ------------------------------------------------------------
-- Part 5 · Per-range colour and fit mode
-- ------------------------------------------------------------
-- color_ranges NULL means "the whole order uses color_mode", which is every
-- existing order -- so nothing already in the table changes meaning.
-- Shape: [{"range": "1-5", "mode": "bw"}, {"range": "6-8", "mode": "color"}]

alter table orders
  add column if not exists color_ranges jsonb,
  add column if not exists fit_mode text not null default 'fit';

alter table orders drop constraint if exists orders_fit_mode_check;
alter table orders add constraint orders_fit_mode_check
  check (fit_mode in ('fit', 'actual'));

-- ------------------------------------------------------------
-- Part 10 · Idempotent order submission
-- ------------------------------------------------------------
-- The customer's browser generates one key per checkout attempt. A double tap
-- or a back-then-resubmit sends the same key and gets the SAME order back
-- instead of a second one. Unique per shop; NULL for orders created before
-- this existed.

alter table orders add column if not exists idempotency_key text;
create unique index if not exists idx_orders_shop_idempotency
  on orders (shop_id, idempotency_key)
  where idempotency_key is not null;

-- ------------------------------------------------------------
-- Part 3 · One payments row per Cashfree order
-- ------------------------------------------------------------
-- Until now our order UUID WAS Cashfree's order_id, so one PrintQ order could
-- only ever have one Cashfree order. Re-pricing an unpaid order and top-ups
-- after payment both need a second one, and Cashfree amounts cannot be
-- changed after creation.
--
-- Each Cashfree order now gets its own payments row carrying the exact id we
-- sent Cashfree. The webhook resolves a payment by that id; existing rows are
-- backfilled with the order UUID, which is what they were created with, so
-- every order already in flight keeps working unchanged.

alter table payments
  add column if not exists cashfree_order_id text,
  add column if not exists purpose text not null default 'order',
  add column if not exists refund_status text,
  add column if not exists refund_amount numeric(10,2),
  add column if not exists refund_id text,
  add column if not exists refunded_at timestamptz;

alter table payments drop constraint if exists payments_purpose_check;
alter table payments add constraint payments_purpose_check
  check (purpose in ('order', 'topup'));

alter table payments drop constraint if exists payments_refund_status_check;
alter table payments add constraint payments_refund_status_check
  check (refund_status is null or refund_status in ('pending', 'succeeded', 'failed'));

-- Today there is exactly one payments row per order. If an order somehow has
-- more, only its earliest Cashfree row takes the id, so the unique index
-- below cannot fail.
update payments p
   set cashfree_order_id = p.order_id::text
  from (
    select distinct on (order_id) id
      from payments
     where gateway = 'cashfree'
     order by order_id, created_at
  ) first_row
 where p.id = first_row.id
   and p.cashfree_order_id is null
   and not exists (
     select 1 from payments q where q.cashfree_order_id = p.order_id::text
   );

create unique index if not exists idx_payments_cashfree_order_id
  on payments (cashfree_order_id)
  where cashfree_order_id is not null;

comment on column payments.cashfree_order_id is
  'The order_id we sent Cashfree for THIS payment. Original = order UUID; top-ups and re-issued sessions get their own.';
comment on column payments.purpose is
  'order: the main charge. topup: an extra charge after the owner raised the price.';

-- ------------------------------------------------------------
-- Part 7.3 · Distinguishable printer failures
-- ------------------------------------------------------------

alter table print_attempts add column if not exists error_code text;
comment on column print_attempts.error_code is
  'Machine-readable failure class from the agent, e.g. printer_offline, out_of_paper, interactive_port.';

-- ------------------------------------------------------------
-- Part 9 · Rate limiting, no new infrastructure
-- ------------------------------------------------------------
-- A fixed-window counter. hit_rate_limit() increments atomically -- one
-- INSERT ... ON CONFLICT takes a row lock -- so concurrent requests cannot
-- both see "under the limit". Old windows are pruned opportunistically.

create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

alter table rate_limits enable row level security;
-- No policy on purpose: only the service role, from server routes, touches it.

create or replace function hit_rate_limit(p_key text, p_window_seconds int, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits int;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update
    set hits = rate_limits.hits + 1
  returning hits into v_hits;

  -- Keep the table small without a scheduled job.
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function hit_rate_limit(text, int, int) from public;
revoke all on function hit_rate_limit(text, int, int) from anon, authenticated;

-- ------------------------------------------------------------
-- Retention cleanup support
-- ------------------------------------------------------------
-- Nothing has ever deleted customer files; file_retention_hours had no
-- effect. The heartbeat route now does it, and needs to find expired files
-- quickly.

create index if not exists idx_order_files_live_by_age
  on order_files (created_at)
  where deleted_at is null;

commit;

-- ------------------------------------------------------------
-- Verify (read-only). Expect: 3 settings columns, 1 print_status check
-- listing the 3 new states, every cashfree payment backfilled (missing = 0).
-- ------------------------------------------------------------
select column_name from information_schema.columns
 where table_name = 'shop_settings'
   and column_name in ('shop_open', 'accepting_orders', 'printing_mode');

select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.orders'::regclass
   and pg_get_constraintdef(oid) like '%print_status%';

select count(*) filter (where cashfree_order_id is null) as missing,
       count(*) as cashfree_payments
  from payments where gateway = 'cashfree';
