-- PLUTUS paper-engine risk hardening blueprint.
-- STAGING/DISPOSABLE DATABASES ONLY: review against the complete live schema and apply
-- only after explicit approval. This file was not applied to Supabase and does not
-- auto-apply anything. It creates no users, accounts, wallet rows, or payment rows.
--
-- This migration is additive and idempotent. Existing engine RPC bodies are deliberately
-- not replaced here: the connected AI must wire server-derived metrics, engine audit,
-- idempotency, and atomic updates only after reviewing the complete SQL and live schema.
-- STAGING ONLY: RPC/worker integration (including an atomic risk-day reset) is required
-- before these server-owned metrics can be considered reliable.

create table if not exists public.pf_engine_risk_profiles (
  account_id text primary key
    references public.pf_engine_accounts(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete restrict,
  timezone text not null default 'UTC'
    check (timezone = 'UTC'),
  reset_time_utc time not null default time '00:00:00',
  daily_drawdown_mode text not null default 'DAY_START'
    check (daily_drawdown_mode in ('STATIC_INITIAL', 'DAY_START', 'TRAILING_PEAK')),
  daily_drawdown_pct numeric(7,4) not null
    check (daily_drawdown_pct > 0 and daily_drawdown_pct <= 100),
  total_drawdown_mode text not null default 'TRAILING_PEAK'
    check (total_drawdown_mode in ('STATIC_INITIAL', 'TRAILING_PEAK')),
  total_drawdown_pct numeric(7,4) not null
    check (total_drawdown_pct > 0 and total_drawdown_pct <= 100),
  profit_target_pct numeric(9,4)
    check (profit_target_pct is null or profit_target_pct >= 0),
  profit_target_basis text not null default 'EQUITY'
    check (profit_target_basis in ('EQUITY', 'REALIZED')),
  min_trading_days integer not null default 0
    check (min_trading_days >= 0),
  consistency_max_winning_day_pct numeric(7,4)
    check (consistency_max_winning_day_pct is null or (consistency_max_winning_day_pct > 0 and consistency_max_winning_day_pct <= 100)),
  payout_share_pct numeric(7,4) not null default 100,
  payout_cap numeric(18,2),
  payout_min_profit_pct numeric(9,4) not null default 0,
  payout_min_trading_days integer not null default 0,
  quote_max_age_ms integer not null default 15000
    check (quote_max_age_ms > 0 and quote_max_age_ms <= 3600000),
  news_block_enabled boolean not null default false,
  service_owned boolean not null default true
    check (service_owned = true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pf_engine_risk_profiles_user_idx
  on public.pf_engine_risk_profiles (user_id, account_id);

-- One server-derived row per account. Writers are trusted RPC/worker code only.
create table if not exists public.pf_engine_account_metrics (
  account_id text primary key
    references public.pf_engine_accounts(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete restrict,
  as_of timestamptz not null,
  balance numeric(18,2) not null,
  floating_pnl numeric(18,2) not null,
  equity numeric(18,2) not null,
  used_margin numeric(18,2) not null check (used_margin >= 0),
  free_margin numeric(18,2) not null,
  -- May be negative when equity is below zero; preserve the risk-breach metric.
  margin_level_pct numeric(18,4),
  peak_equity numeric(18,2) not null,
  -- Explicit server-owned UTC risk-day state; reset atomically by the trusted RPC/worker.
  risk_day date not null,
  daily_start_equity numeric(18,2) not null,
  daily_peak_equity numeric(18,2) not null,
  daily_drawdown numeric(18,2) not null check (daily_drawdown >= 0),
  total_drawdown numeric(18,2) not null check (total_drawdown >= 0),
  total_drawdown_mode text not null
    check (total_drawdown_mode in ('STATIC_INITIAL', 'TRAILING_PEAK')),
  profit_target numeric(18,2),
  profit_progress numeric(18,2) not null,
  trading_days integer not null check (trading_days >= 0),
  consistency_ratio_pct numeric(18,4)
    check (consistency_ratio_pct is null or consistency_ratio_pct >= 0),
  daily_drawdown_breached boolean not null,
  total_drawdown_breached boolean not null,
  profit_target_reached boolean not null,
  min_trading_days_met boolean not null,
  consistency_met boolean not null,
  all_quotes_fresh boolean not null,
  payout_eligible boolean not null default false,
  last_quote_at timestamptz,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  updated_at timestamptz not null default now()
);

create index if not exists pf_engine_account_metrics_user_idx
  on public.pf_engine_account_metrics (user_id, updated_at desc);
create index if not exists pf_engine_account_metrics_payout_idx
  on public.pf_engine_account_metrics (payout_eligible, updated_at desc)
  where payout_eligible = true;
-- Both tables have independent FKs for account_id -> engine account and user_id ->
-- auth user. The live engine-account owner column is intentionally not assumed here;
-- the trusted RPC must validate the account/user pair before writing either row.
comment on column public.pf_engine_risk_profiles.user_id is
  'FK to auth.users; trusted RPC must also validate ownership of account_id.';
comment on column public.pf_engine_account_metrics.user_id is
  'FK to auth.users; trusted RPC must also validate ownership of account_id.';

-- Existing installations may have the table already. These columns remain nullable for
-- legacy rows until a trusted worker backfills them; new writes must supply both values.
alter table public.pf_engine_risk_profiles
  add column if not exists payout_share_pct numeric(7,4) not null default 100;
alter table public.pf_engine_risk_profiles
  add column if not exists payout_cap numeric(18,2);
alter table public.pf_engine_risk_profiles
  add column if not exists payout_min_profit_pct numeric(9,4) not null default 0;
alter table public.pf_engine_risk_profiles
  add column if not exists payout_min_trading_days integer not null default 0;
alter table public.pf_engine_account_metrics
  add column if not exists risk_day date;
alter table public.pf_engine_account_metrics
  add column if not exists daily_peak_equity numeric(18,2);
create index if not exists pf_engine_account_metrics_risk_day_idx
  on public.pf_engine_account_metrics (account_id, risk_day, updated_at desc);

-- Enforce new writes while allowing staged review of any legacy rows.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.pf_engine_risk_profiles'::regclass and conname = 'pf_engine_risk_profiles_payout_share_range') then
    alter table public.pf_engine_risk_profiles add constraint pf_engine_risk_profiles_payout_share_range check (payout_share_pct between 0 and 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pf_engine_risk_profiles'::regclass and conname = 'pf_engine_risk_profiles_payout_cap_nonnegative') then
    alter table public.pf_engine_risk_profiles add constraint pf_engine_risk_profiles_payout_cap_nonnegative check (payout_cap is null or payout_cap >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pf_engine_risk_profiles'::regclass and conname = 'pf_engine_risk_profiles_payout_min_profit_nonnegative') then
    alter table public.pf_engine_risk_profiles add constraint pf_engine_risk_profiles_payout_min_profit_nonnegative check (payout_min_profit_pct >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pf_engine_risk_profiles'::regclass and conname = 'pf_engine_risk_profiles_payout_min_days_nonnegative') then
    alter table public.pf_engine_risk_profiles add constraint pf_engine_risk_profiles_payout_min_days_nonnegative check (payout_min_trading_days >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pf_engine_account_metrics'::regclass and conname = 'pf_engine_metrics_daily_peak_gte_start') then
    alter table public.pf_engine_account_metrics add constraint pf_engine_metrics_daily_peak_gte_start check (daily_peak_equity is null or daily_start_equity is null or daily_peak_equity >= daily_start_equity) not valid;
  end if;
end
$$;

comment on column public.pf_engine_account_metrics.risk_day is
  'Server-owned UTC risk day. Trusted RPC must reset risk_day, daily_start_equity, and daily_peak_equity atomically; staging only.';
comment on column public.pf_engine_account_metrics.daily_peak_equity is
  'Peak scoped to risk_day, never the historical account peak. RPC/worker integration is required before metrics are trusted.';

-- Staging-only atomic reset primitive. The production RPC/worker must call this in
-- the same transaction as its metric calculation; it deliberately does not infer a
-- start equity or peak from trades. No client role receives EXECUTE.
create or replace function public.pf_engine_reset_daily_metrics(
  p_account_id text,
  p_user_id uuid,
  p_risk_day date,
  p_daily_start_equity numeric,
  p_daily_peak_equity numeric
)
returns setof public.pf_engine_account_metrics
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_account_id is null or p_user_id is null or p_risk_day is null
     or p_daily_start_equity is null or p_daily_peak_equity is null
     or p_daily_start_equity <= 0 or p_daily_peak_equity <= 0
     or p_daily_peak_equity < p_daily_start_equity then
    raise exception 'invalid server-owned daily metric reset';
  end if;

  return query
    update public.pf_engine_account_metrics
       set risk_day = p_risk_day,
           daily_start_equity = p_daily_start_equity,
           daily_peak_equity = p_daily_peak_equity,
           updated_at = now()
     where account_id = p_account_id
       and user_id = p_user_id
    returning *;
end;
$$;
revoke all on function public.pf_engine_reset_daily_metrics(text, uuid, date, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.pf_engine_reset_daily_metrics(text, uuid, date, numeric, numeric)
  to service_role;

-- This is intentionally separate from pf_security_audit. That existing table has a
-- narrow action CHECK used by funding-request RPCs; changing or duplicating its actions
-- would risk breaking those RPCs. This engine-scoped log is server-only and has no client
-- write policy. The final trusted RPC/worker must insert it in the same transaction as
-- the state change and use request_id for idempotency.
create table if not exists public.pf_engine_audit_log (
  id bigint generated always as identity primary key,
  account_id text
    references public.pf_engine_accounts(id) on delete set null,
  user_id uuid
    references auth.users(id) on delete set null,
  actor_id uuid
    references auth.users(id) on delete set null,
  -- A request may legitimately emit several actions. Idempotency is scoped below
  -- by request/action/entity; the trusted RPC must still use the same transaction.
  request_id uuid,
  action text not null
    check (action ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  entity_type text not null
    check (entity_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  entity_id text,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists pf_engine_audit_account_created_idx
  on public.pf_engine_audit_log (account_id, created_at desc);
create index if not exists pf_engine_audit_user_created_idx
  on public.pf_engine_audit_log (user_id, created_at desc);
create index if not exists pf_engine_audit_entity_idx
  on public.pf_engine_audit_log (entity_type, entity_id, created_at desc);

-- Upgrade databases produced by the earlier draft, whose request_id UNIQUE blocked
-- more than one action for a request. NULL request IDs are intentionally not indexed.
alter table public.pf_engine_audit_log
  drop constraint if exists pf_engine_audit_log_request_id_key;
drop index if exists public.pf_engine_audit_log_request_id_key;
create unique index if not exists pf_engine_audit_request_action_entity_uidx
  on public.pf_engine_audit_log (coalesce(account_id, ''), coalesce(user_id::text, ''), request_id, action, entity_type, coalesce(entity_id, ''))
  where request_id is not null;

-- Optional input table for verified economic events. No provider, event, or news
-- entitlement is invented here. A trusted ingestion process must supply and verify rows.
create table if not exists public.pf_engine_news_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique
    check (event_key ~ '^[A-Za-z0-9_.:-]{2,160}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  symbols text[],
  impact text not null default 'UNKNOWN'
    check (impact in ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
  source text not null
    check (length(btrim(source)) between 1 and 200),
  verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid
    references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (verified = false or (verified_at is not null and verified_by is not null)),
  check (symbols is null or cardinality(symbols) between 1 and 100)
);

create index if not exists pf_engine_news_events_window_idx
  on public.pf_engine_news_events (starts_at, ends_at)
  where active = true and verified = true;
create index if not exists pf_engine_news_events_symbols_idx
  on public.pf_engine_news_events using gin (symbols)
  where active = true and verified = true;

-- Preserve execution provenance without changing the existing order/position/history
-- contracts. The service must write only server-derived JSON objects; clients receive
-- read-only projections. No assumptions about provider-specific keys are made here.
alter table public.pf_engine_orders
  add column if not exists execution_metadata jsonb not null default '{}'::jsonb;
alter table public.pf_engine_positions
  add column if not exists execution_metadata jsonb not null default '{}'::jsonb;
alter table public.pf_engine_trades_history
  add column if not exists execution_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pf_engine_orders'::regclass
      and conname = 'pf_engine_orders_execution_metadata_object'
  ) then
    alter table public.pf_engine_orders
      add constraint pf_engine_orders_execution_metadata_object
      check (jsonb_typeof(execution_metadata) = 'object');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pf_engine_positions'::regclass
      and conname = 'pf_engine_positions_execution_metadata_object'
  ) then
    alter table public.pf_engine_positions
      add constraint pf_engine_positions_execution_metadata_object
      check (jsonb_typeof(execution_metadata) = 'object');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pf_engine_trades_history'::regclass
      and conname = 'pf_engine_history_execution_metadata_object'
  ) then
    alter table public.pf_engine_trades_history
      add constraint pf_engine_history_execution_metadata_object
      check (jsonb_typeof(execution_metadata) = 'object');
  end if;
end
$$;

drop index if exists public.pf_engine_orders_execution_metadata_idx;
create index if not exists pf_engine_orders_account_updated_idx
  on public.pf_engine_orders (account_id, updated_at desc);
drop index if exists public.pf_engine_positions_execution_metadata_idx;
create index if not exists pf_engine_positions_account_opened_idx
  on public.pf_engine_positions (account_id, opened_at desc);
drop index if exists public.pf_engine_history_execution_metadata_idx;
create index if not exists pf_engine_trades_history_account_closed_idx
  on public.pf_engine_trades_history (account_id, closed_at desc);

-- Safe-by-default grants: authenticated users can read only their own derived
-- profile/metrics. There are deliberately no client INSERT/UPDATE/DELETE policies.
-- service_role (or a narrowly controlled server role) performs all writes.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'pf_engine_risk_profiles',
    'pf_engine_account_metrics',
    'pf_engine_audit_log',
    'pf_engine_news_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
  end loop;
end
$$;

grant select on public.pf_engine_risk_profiles, public.pf_engine_account_metrics to authenticated;

-- Drop/recreate only policies owned by this additive migration, making reruns safe.
drop policy if exists pf_engine_risk_profiles_owner_read on public.pf_engine_risk_profiles;
create policy pf_engine_risk_profiles_owner_read
  on public.pf_engine_risk_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists pf_engine_account_metrics_owner_read on public.pf_engine_account_metrics;
create policy pf_engine_account_metrics_owner_read
  on public.pf_engine_account_metrics
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No policies or authenticated grants are created for pf_engine_audit_log or
-- pf_engine_news_events: they are server-only, even though RLS is enabled.
-- No changes are made to pf_security_audit, payment, wallet, auth, or existing RPC bodies.
