-- Align database account-profile constraints with the broker profiles accepted by mt5-bridge.
-- Existing installations created by 202611160001 only allowed STANDARD_CENT and STANDARD,
-- while the Edge Function also supports ZERO and PRO. This migration makes both tables consistent.
alter table public.mt5_pairing_codes
  drop constraint if exists mt5_pairing_codes_account_profile_check;
alter table public.mt5_pairing_codes
  add constraint mt5_pairing_codes_account_profile_check
  check (account_profile in ('STANDARD_CENT','ZERO','PRO','STANDARD'));

alter table public.mt5_devices
  drop constraint if exists mt5_devices_account_profile_check;
alter table public.mt5_devices
  add constraint mt5_devices_account_profile_check
  check (account_profile in ('STANDARD_CENT','ZERO','PRO','STANDARD'));
