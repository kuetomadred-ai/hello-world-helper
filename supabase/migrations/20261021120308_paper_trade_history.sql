-- Append-only customer trade history. Trade close events are copied from the trusted ledger.
create table public.pf_engine_trades_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  position_id uuid not null references public.pf_engine_positions(id) on delete restrict,
  account_id text not null references public.pf_engine_accounts(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  symbol text not null references public.pf_engine_instruments(symbol),
  side text not null check (side in ('buy','sell')),
  lots_closed numeric(10,2) not null check (lots_closed between 0.01 and 100),
  entry_price numeric(24,12) not null check (entry_price > 0),
  exit_price numeric(24,12) not null check (exit_price > 0),
  realized_pnl numeric(18,2) not null,
  close_reason text not null check (close_reason in ('MANUAL','SL','TP','PARTIAL')),
  opened_at timestamptz not null,
  closed_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
create index pf_engine_history_owner_idx
  on public.pf_engine_trades_history(user_id,closed_at desc);
create index pf_engine_history_account_idx
  on public.pf_engine_trades_history(account_id,closed_at desc);

alter table public.pf_engine_trades_history enable row level security;
revoke all on public.pf_engine_trades_history from anon, authenticated;
grant select on public.pf_engine_trades_history to authenticated;
create policy pf_engine_history_owner_read
  on public.pf_engine_trades_history
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.pf_engine_capture_trade_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  position_row public.pf_engine_positions;
  closed_lots numeric;
  close_price numeric;
  close_label text;
begin
  if new.event not in ('POSITION_CLOSED','POSITION_PARTIAL_CLOSE') or new.position_id is null then
    return new;
  end if;

  select * into position_row
  from public.pf_engine_positions
  where id = new.position_id;
  if not found then
    return new;
  end if;

  if new.event = 'POSITION_PARTIAL_CLOSE' then
    closed_lots := nullif(new.details->>'lots','')::numeric;
    close_label := 'PARTIAL';
  else
    closed_lots := position_row.lots;
    close_label := coalesce(nullif(new.details->>'reason',''), position_row.close_reason, 'MANUAL');
  end if;
  close_price := coalesce(nullif(new.details->>'price','')::numeric, position_row.exit_price);

  if closed_lots is null or close_price is null then
    raise exception using errcode='22023', message='Trade history requires closed lots and exit price';
  end if;

  insert into public.pf_engine_trades_history(
    request_id,position_id,account_id,user_id,symbol,side,lots_closed,
    entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at,details
  ) values (
    new.request_id,position_row.id,new.account_id,new.user_id,position_row.symbol,
    position_row.side,closed_lots,
    coalesce(nullif(new.details->>'entry','')::numeric,position_row.entry_price),
    close_price,new.amount,close_label,position_row.opened_at,new.created_at,new.details
  ) on conflict (request_id) do nothing;
  return new;
end;
$$;
revoke all on function public.pf_engine_capture_trade_history() from public, anon, authenticated, service_role;
create trigger pf_engine_ledger_capture_trade_history
  after insert on public.pf_engine_ledger
  for each row execute function public.pf_engine_capture_trade_history();
