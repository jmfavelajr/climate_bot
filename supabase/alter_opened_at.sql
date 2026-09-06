alter table trade_candidates add column if not exists opened_at timestamptz default now();
