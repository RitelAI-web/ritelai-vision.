-- RitelAI MT5 bridge compatibility + REAL monitor metadata.
-- Safe migration: REAL accounts remain monitor-only in the Edge Function.
alter table public.mt5_pairing_codes
  drop constraint if exists mt5_pairing_codes_broker_check,
  drop constraint if exists mt5_pairing_codes_account_profile_check;
alter table public.mt5_pairing_codes
  add constraint mt5_pairing_codes_broker_check check (broker in ('EXNESS','VERSUS_TRADE')),
  add constraint mt5_pairing_codes_account_profile_check check (account_profile in ('CENT','STANDARD_CENT','STANDARD','ZERO','RAW','PRO','ECN','ISLAMIC','OTHER'));

alter table public.mt5_devices
  drop constraint if exists mt5_devices_broker_check,
  drop constraint if exists mt5_devices_account_profile_check;
alter table public.mt5_devices
  add constraint mt5_devices_broker_check check (broker in ('EXNESS','VERSUS_TRADE')),
  add constraint mt5_devices_account_profile_check check (account_profile in ('CENT','STANDARD_CENT','STANDARD','ZERO','RAW','PRO','ECN','ISLAMIC','OTHER'));

alter table public.mt5_devices
  add column if not exists account_currency text,
  add column if not exists account_leverage integer,
  add column if not exists execution_mode text not null default 'SEMI_AUTO',
  add column if not exists emergency_stop boolean not null default true,
  add column if not exists max_risk_pct numeric not null default 0.5,
  add column if not exists max_daily_loss_pct numeric not null default 2,
  add column if not exists max_spread_points integer not null default 80,
  add column if not exists max_open_positions integer not null default 1;

-- All newly paired devices begin with Emergency Stop enabled.
update public.mt5_devices set emergency_stop=true where emergency_stop is distinct from true;
