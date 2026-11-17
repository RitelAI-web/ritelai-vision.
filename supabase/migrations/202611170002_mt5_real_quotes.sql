-- REAL monitor-only market quote fields. No trade execution permissions are added.
alter table public.mt5_devices
  add column if not exists last_bid numeric,
  add column if not exists last_ask numeric,
  add column if not exists last_spread_points numeric,
  add column if not exists last_tick_at timestamptz;
