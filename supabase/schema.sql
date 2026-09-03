-- Run this once in the Supabase SQL editor.

create table if not exists forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_ticker text not null,
  location text,
  forecast_date date,
  om_temp numeric,
  nws_temp numeric,
  live_sigma numeric,
  confidence numeric,
  disagreement numeric,
  revision_delta numeric,
  revision_flagged boolean default false,
  observed_at timestamptz not null default now()
);

create index if not exists forecast_snapshots_ticker_obs
  on forecast_snapshots (event_ticker, observed_at desc);

create table if not exists trade_candidates (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  market_ticker text not null,
  event_ticker text,
  confidence numeric,
  revision_flagged boolean default false,
  revision_delta numeric,
  action text not null default 'paper',
  reason text,
  yes_ask numeric,
  om_temp numeric,
  nws_temp numeric,
  live_sigma numeric,
  settled_temp numeric,
  pnl numeric
);

create index if not exists trade_candidates_ticker_run
  on trade_candidates (market_ticker, run_at desc);

alter table forecast_snapshots enable row level security;
alter table trade_candidates enable row level security;

create policy "service or authenticated read snapshots"
  on forecast_snapshots for select
  using (true);

create policy "service or authenticated read candidates"
  on trade_candidates for select
  using (true);
