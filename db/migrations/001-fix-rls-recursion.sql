-- ============================================================
-- 001 · Fix infinite recursion in Row Level Security policies
-- ============================================================
--
-- SYMPTOM
--   Every authenticated read of shops / shop_members / pricing / orders
--   failed with:
--     42P17: infinite recursion detected in policy for relation "shop_members"
--   In the app this showed up as the dashboard queue stuck on "Loading…".
--
-- CAUSE
--   The SELECT policy on shop_members queried shop_members:
--
--     create policy shop_members_select on shop_members
--       for select using (
--         shop_id in (select shop_id from shop_members where user_id = auth.uid())
--       );
--
--   Evaluating that subquery re-enters the very policy being evaluated, so
--   Postgres recurses until it aborts. The policies on shops, pricing and
--   orders all reference shop_members too, so they failed for the same reason.
--
-- FIX
--   Look the membership up through a SECURITY DEFINER function. It runs as
--   the function owner, for whom RLS is not applied, so the lookup does not
--   re-enter the policy. The function is still scoped to auth.uid(), so a
--   caller can only ever learn their own shop ids.
--
-- Safe to run more than once.

-- ------------------------------------------------------------
-- Membership helper
-- ------------------------------------------------------------

create or replace function public.my_shop_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public          -- pin the path; a SECURITY DEFINER function
as $$                             -- must not resolve names via the caller's
  select shop_id                  -- search_path.
  from public.shop_members
  where user_id = auth.uid()
$$;

comment on function public.my_shop_ids is
  'Shop ids the current user belongs to. SECURITY DEFINER so RLS policies can '
  'call it without re-entering the shop_members policy (see migration 001).';

revoke all on function public.my_shop_ids() from public;
grant execute on function public.my_shop_ids() to authenticated;

-- ------------------------------------------------------------
-- shop_members — the source of the recursion
-- ------------------------------------------------------------

drop policy if exists shop_members_select on shop_members;
create policy shop_members_select on shop_members
  for select using (
    -- Your own membership row, plus everyone in shops you belong to.
    user_id = auth.uid()
    or shop_id in (select public.my_shop_ids())
  );

drop policy if exists shop_members_self_insert on shop_members;
create policy shop_members_self_insert on shop_members
  for insert with check (
    user_id = auth.uid()
    or shop_id in (select public.my_shop_ids())
  );

-- ------------------------------------------------------------
-- Tables whose policies referenced shop_members
-- ------------------------------------------------------------

drop policy if exists shop_isolation_shops_rw on shops;
create policy shop_isolation_shops_rw on shops
  for select using (id in (select public.my_shop_ids()));

drop policy if exists shop_isolation_shops_update on shops;
create policy shop_isolation_shops_update on shops
  for update using (id in (select public.my_shop_ids()));

drop policy if exists shop_isolation_pricing on pricing;
create policy shop_isolation_pricing on pricing
  for all using (shop_id in (select public.my_shop_ids()))
  with check (shop_id in (select public.my_shop_ids()));

drop policy if exists shop_isolation_orders on orders;
create policy shop_isolation_orders on orders
  for all using (shop_id in (select public.my_shop_ids()))
  with check (shop_id in (select public.my_shop_ids()));

-- ------------------------------------------------------------
-- print_agents — RLS was enabled but no policy was ever created,
-- so it denied everything and the dashboard's agent indicator was
-- permanently stuck on "Agent offline".
-- ------------------------------------------------------------

drop policy if exists shop_isolation_print_agents on print_agents;
create policy shop_isolation_print_agents on print_agents
  for select using (shop_id in (select public.my_shop_ids()));

-- NOTE: shop_settings, licences, printers, order_files, payments, print_jobs,
-- print_attempts and queue_entries also have RLS enabled with no policy, which
-- denies all browser-client access. That is intentional for now — the app only
-- reaches those through server-side routes using the service-role client. If a
-- dashboard page is ever changed to read one of them directly from the browser,
-- it will need a policy here.
