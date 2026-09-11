-- PrintQ database schema (Postgres / Supabase)
-- Multi-tenant from day one: every row that belongs to a shop carries
-- shop_id, and Row Level Security policies enforce that a shop can
-- only ever see its own rows. Run this against a fresh Supabase
-- project (SQL editor) or any Postgres 14+ instance.

create extension if not exists "pgcrypto";

-- ============================================================
-- USERS / SHOPS
-- ============================================================

-- In Supabase, auth.users already exists; this table extends it.
create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                -- used in printq.in/p/{slug}
  owner_user_id uuid not null,               -- references auth.users(id)
  shop_name text not null,
  owner_name text not null,
  phone text not null,
  email text not null,
  address text,
  city text,
  state text,
  pincode text,
  gstin text,
  logo_url text,
  status text not null default 'active'      -- active | suspended | expired
    check (status in ('active', 'suspended', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  unique (shop_id, user_id)
);

-- ============================================================
-- PRICING
-- ============================================================

create table if not exists pricing (
  shop_id uuid primary key references shops(id) on delete cascade,
  a4_bw_per_page numeric(10,2) not null default 1.00,
  a4_color_per_page numeric(10,2) not null default 5.00,
  a3_bw_per_page numeric(10,2) not null default 2.00,
  a3_color_per_page numeric(10,2) not null default 8.00,
  duplex_discount_percent numeric(5,2) not null default 0,
  minimum_order_amount numeric(10,2) not null default 0,
  enabled_paper_sizes text[] not null default array['A4'],
  updated_at timestamptz not null default now()
);

-- ============================================================
-- SHOP SETTINGS / PAYMENT CONFIG
-- ============================================================

create table if not exists shop_settings (
  shop_id uuid primary key references shops(id) on delete cascade,
  upi_id text,                               -- shop's own UPI VPA, e.g. shop@okhdfcbank
  payment_gateway text,                      -- null | 'razorpay' | 'cashfree'
  payment_gateway_account_id text,           -- shop's own connected account, never ours
  heartbeat_timeout_seconds int not null default 90,
  file_retention_hours int not null default 24,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- LICENCES / SUBSCRIPTION
-- ============================================================

create table if not exists licences (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  plan text not null default 'setup_12mo' check (plan in ('setup_12mo', 'monthly', 'yearly')),
  status text not null default 'active' check (status in ('active', 'grace', 'expired', 'cancelled')),
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  grace_period_days int not null default 7,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PRINTERS / AGENTS
-- ============================================================

create table if not exists print_agents (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  agent_secret_hash text not null,           -- hashed pairing secret, never store raw
  hostname text,
  version text,
  last_heartbeat_at timestamptz,
  status text not null default 'offline' check (status in ('online', 'offline')),
  created_at timestamptz not null default now()
);

create table if not exists printers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  agent_id uuid references print_agents(id) on delete set null,
  system_name text not null,                 -- exact Windows printer name
  display_name text not null,
  is_default boolean not null default false,
  is_enabled boolean not null default true,
  supports_color boolean not null default false,
  supports_duplex boolean not null default false,
  supported_paper_sizes text[] not null default array['A4'],
  last_status text,                          -- e.g. 'ready', 'out_of_paper', 'offline'
  updated_at timestamptz not null default now()
);

-- ============================================================
-- ORDERS / QUEUE
-- ============================================================

create sequence if not exists global_order_seq;

-- Per-shop, per-day token counter. Incremented atomically inside the
-- same transaction that creates the order (see get_next_token below) -
-- this is the concurrency-safe replacement for "read last token, add 1"
-- in application code, which races under load.
create table if not exists shop_token_counters (
  shop_id uuid not null references shops(id) on delete cascade,
  counter_date date not null,
  last_counter int not null default 0,
  primary key (shop_id, counter_date)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  public_order_id text not null unique default ('PQ' || nextval('global_order_seq')::text),
  shop_id uuid not null references shops(id) on delete cascade,
  customer_session_token uuid not null default gen_random_uuid(),

  token_number text,                          -- e.g. 'A042', assigned on payment confirmation
  token_counter int,

  color_mode text not null check (color_mode in ('bw', 'color')),
  paper_size text not null check (paper_size in ('A4', 'A3')),
  orientation text not null default 'auto' check (orientation in ('portrait', 'landscape', 'auto')),
  sides text not null default 'single' check (sides in ('single', 'double')),
  copies int not null check (copies > 0),
  page_range text not null default 'all',
  page_count int,                             -- filled in after conversion/inspection

  price_breakdown jsonb,                      -- server-calculated, immutable once payment created
  amount numeric(10,2),

  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'expired', 'refunded')),
  print_status text not null default 'created'
    check (print_status in (
      'created', 'payment_pending', 'paid', 'queued', 'claimed',
      'print_attempted', 'printing', 'completed', 'failed', 'cancelled', 'held'
    )),

  printer_id uuid references printers(id),

  created_at timestamptz not null default now(),
  paid_at timestamptz,
  print_started_at timestamptz,
  completed_at timestamptz,
  failure_reason text
);

create index if not exists idx_orders_shop_status on orders (shop_id, print_status);
create index if not exists idx_orders_shop_created on orders (shop_id, created_at desc);

create table if not exists order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  original_filename text not null,
  storage_path text not null,                 -- private bucket path, never a public URL
  converted_storage_path text,                -- PDF after conversion, if applicable
  mime_type text not null,
  size_bytes bigint not null,
  deleted_at timestamptz,                     -- set once retention policy removes the file
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  method text not null check (method in ('upi_intent', 'gateway')),
  gateway text,                               -- 'razorpay' | 'cashfree' | null for raw UPI intent
  gateway_payment_id text,
  gateway_signature text,
  amount numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired', 'refunded')),
  raw_webhook_payload jsonb,                  -- for audit; never trust this alone, verify signature
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create table if not exists print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  state text not null default 'CREATED',
  claimed_by_agent_id uuid references print_agents(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists print_attempts (
  id uuid primary key default gen_random_uuid(),
  print_job_id uuid not null references print_jobs(id) on delete cascade,
  agent_id uuid not null references print_agents(id),
  attempt_number int not null,
  printer_id uuid references printers(id),
  attempted_at timestamptz not null default now(),
  result text check (result in ('sent', 'confirmed', 'error', 'timeout')),
  error_message text,
  unique (print_job_id, attempt_number)
);

create table if not exists queue_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  position int not null,
  created_at timestamptz not null default now()
);

-- Deliberately NOT covered by the shop-isolation RLS policies below,
-- and never selected via the browser client. The admin route
-- (src/app/admin/page.tsx) reads this exclusively through the
-- service-role client after already confirming a session exists, so
-- a bug in RLS policy scope can't accidentally expose or grant admin.
create table if not exists admin_users (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('shop_owner', 'admin', 'agent', 'system')),
  actor_id text,
  shop_id uuid references shops(id),
  action text not null,
  target_table text,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ATOMIC TOKEN ASSIGNMENT (concurrency-safe)
-- ============================================================

create or replace function get_next_token(p_shop_id uuid)
returns int
language plpgsql
as $$
declare
  v_counter int;
begin
  insert into shop_token_counters (shop_id, counter_date, last_counter)
  values (p_shop_id, current_date, 1)
  on conflict (shop_id, counter_date) do update
    set last_counter = shop_token_counters.last_counter + 1
  returning last_counter into v_counter;
  -- The INSERT ... ON CONFLICT DO UPDATE above is atomic per row in
  -- Postgres (it takes a row-level lock), so concurrent callers cannot
  -- both receive the same counter value.
  return v_counter;
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY (tenant isolation)
-- ============================================================

alter table shops enable row level security;
alter table pricing enable row level security;
alter table shop_settings enable row level security;
alter table printers enable row level security;
alter table print_agents enable row level security;
alter table orders enable row level security;
alter table order_files enable row level security;
alter table payments enable row level security;
alter table print_jobs enable row level security;
alter table print_attempts enable row level security;
alter table queue_entries enable row level security;
alter table licences enable row level security;

-- A shop owner/staff member can only touch rows for shops they belong to.
-- `using` governs SELECT/UPDATE/DELETE; `with check` separately governs
-- INSERT/UPDATE - both are required, or registration (the first INSERT,
-- before a shop_members row exists yet) silently fails.

-- Membership is looked up through a SECURITY DEFINER helper. A policy on
-- shop_members that itself selects from shop_members would re-enter the
-- policy being evaluated and abort with 42P17 (infinite recursion); the
-- helper runs as its owner, for whom RLS is not applied, so the lookup
-- terminates. It is still scoped to auth.uid(), so a caller can only ever
-- learn their own shop ids.

create or replace function public.my_shop_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select shop_id from public.shop_members where user_id = auth.uid()
$$;

revoke all on function public.my_shop_ids() from public;
grant execute on function public.my_shop_ids() to authenticated;

create policy shop_isolation_shops_rw on shops
  for select using (id in (select public.my_shop_ids()));
create policy shop_isolation_shops_update on shops
  for update using (id in (select public.my_shop_ids()));
-- Any authenticated user may create a shop (this is shop registration);
-- app code inserts the matching shop_members owner row in the same
-- transaction immediately after, which is what grants future access.
create policy shop_registration_insert on shops
  for insert with check (auth.uid() = owner_user_id);

create policy shop_members_self_insert on shop_members
  for insert with check (
    -- Can insert yourself as owner of a shop you just created, or be
    -- added by an existing member of that shop.
    user_id = auth.uid()
    or shop_id in (select public.my_shop_ids())
  );
create policy shop_members_select on shop_members
  for select using (
    user_id = auth.uid()
    or shop_id in (select public.my_shop_ids())
  );

create policy shop_isolation_pricing on pricing
  for all using (shop_id in (select public.my_shop_ids()))
  with check (shop_id in (select public.my_shop_ids()));

create policy shop_isolation_orders on orders
  for all using (shop_id in (select public.my_shop_ids()))
  with check (shop_id in (select public.my_shop_ids()));

-- The dashboard reads agent status from the browser, so print_agents needs
-- its own policy; without one, RLS denies every row and the agent indicator
-- is permanently stuck on "offline".
create policy shop_isolation_print_agents on print_agents
  for select using (shop_id in (select public.my_shop_ids()));

-- Customers never authenticate, so customer-facing reads/writes go
-- through server-side API routes using the service role key (never
-- exposed to the browser), which apply their own authorization checks
-- (e.g. matching customer_session_token) instead of relying on RLS.
-- Admin routes use a separate service-role connection and their own
-- is_admin() check - never a client-side Supabase key.

comment on table orders is 'Core order record. price_breakdown and amount are set exclusively by server-side code, never trusted from the client.';
comment on function get_next_token is 'Call inside the same transaction as the order INSERT that assigns token_number, to keep token issuance and order creation atomic together.';
