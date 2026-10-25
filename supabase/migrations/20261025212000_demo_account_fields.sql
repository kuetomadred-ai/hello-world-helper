-- Demo account metadata used by the isolated device onboarding route and Dashboard.
alter table public.pf_engine_accounts
  add column if not exists program text not null default 'PAPER',
  add column if not exists phase integer not null default 1,
  add column if not exists day_start_balance numeric(18,2) not null default 10000,
  add column if not exists min_equity numeric(18,2) not null default 10000,
  add column if not exists challenge_status text not null default 'ACTIVE';
