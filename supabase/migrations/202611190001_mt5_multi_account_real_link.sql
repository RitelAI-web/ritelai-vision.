-- RitelAI multi-account MT5 profiles and guarded REAL account linking.
-- Apply after 202611160001_mt5_bridge.sql and the existing MT5 safety migrations.
-- REAL accounts can be paired and monitored; order execution remains disabled.
alter table public.mt5_pairing_codes
  drop constraint if exists mt5_pairing_codes_broker_check,
  drop constraint if exists mt5_pairing_codes_account_profile_check;
alter table public.mt5_pairing_codes
  add constraint mt5_pairing_codes_broker_check
    check (broker ~ '^[A-Z0-9_ -]{2,24}$'),
  add constraint mt5_pairing_codes_account_profile_check
    check (account_profile in ('CENT','STANDARD_CENT','STANDARD','ZERO','RAW','PRO','ECN','ISLAMIC','OTHER'));

alter table public.mt5_devices
  drop constraint if exists mt5_devices_broker_check,
  drop constraint if exists mt5_devices_account_profile_check;
alter table public.mt5_devices
  add constraint mt5_devices_broker_check
    check (broker ~ '^[A-Z0-9_ -]{2,24}$'),
  add constraint mt5_devices_account_profile_check
    check (account_profile in ('CENT','STANDARD_CENT','STANDARD','ZERO','RAW','PRO','ECN','ISLAMIC','OTHER'));

alter table public.mt5_devices
  add column if not exists account_currency text,
  add column if not exists account_leverage integer,
  add column if not exists strategy_profile jsonb not null default '{}'::jsonb,
  add column if not exists real_execution_enabled boolean not null default false,
  add column if not exists real_acknowledged_at timestamptz;

-- Keep each connected terminal independently addressable for multi-account Elite users.
create index if not exists mt5_devices_user_login_idx
  on public.mt5_devices(user_id, account_login, terminal_server);
create index if not exists mt5_devices_user_environment_idx
  on public.mt5_devices(user_id, is_demo, enabled);

-- A REAL terminal must never inherit an enabled execution flag from an old row.
update public.mt5_devices
   set real_execution_enabled=false, real_acknowledged_at=null
 where is_demo=false;
