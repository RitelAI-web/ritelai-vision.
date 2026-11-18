create table if not exists public.market_ohlc_bars (
 id bigint generated always as identity primary key,
 symbol text not null check (symbol in ('XAUUSD','BTCUSD','EURUSD','GBPUSD','USDJPY','US30','ETHUSD','SOLUSD')),
 timeframe text not null check (timeframe in ('1m','5m','15m','30m','1h','4h','1d')),
 open_time timestamptz not null,
 open numeric(24,10) not null check (open > 0),
 high numeric(24,10) not null check (high > 0),
 low numeric(24,10) not null check (low > 0),
 close numeric(24,10) not null check (close > 0),
 volume numeric(28,8),
 tick_volume bigint,
 source text not null default 'BiQuote',
 fetched_at timestamptz not null default now(),
 unique(symbol,timeframe,open_time),
 check (high >= low and high >= greatest(open,close) and low <= least(open,close))
);
create index if not exists market_ohlc_bars_lookup_idx on public.market_ohlc_bars(symbol,timeframe,open_time desc);
alter table public.market_ohlc_bars enable row level security;
revoke all on public.market_ohlc_bars from anon, authenticated;
grant all on public.market_ohlc_bars to service_role;
create table if not exists public.backtest_runs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 symbol text not null,
 timeframe text not null,
 strategy text not null,
 parameters jsonb not null default '{}'::jsonb,
 metrics jsonb not null default '{}'::jsonb,
 sample_start timestamptz,
 sample_end timestamptz,
 candle_count integer not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists backtest_runs_user_created_idx on public.backtest_runs(user_id,created_at desc);
alter table public.backtest_runs enable row level security;
create policy "Users can read own backtests" on public.backtest_runs for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert own backtests" on public.backtest_runs for insert to authenticated with check (auth.uid() = user_id);
revoke all on public.backtest_runs from anon;
grant select,insert on public.backtest_runs to authenticated;
grant all on public.backtest_runs to service_role;