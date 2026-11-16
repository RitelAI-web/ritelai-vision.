-- RitelAI MT5 bridge schema. Apply once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.mt5_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  broker text not null check (broker in ('EXNESS','VERSUS_TRADE')),
  account_profile text not null check (account_profile in ('STANDARD_CENT','STANDARD')),
  expected_demo boolean not null default true,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mt5_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  broker text not null check (broker in ('EXNESS','VERSUS_TRADE')),
  account_profile text not null check (account_profile in ('STANDARD_CENT','STANDARD')),
  terminal_server text,
  account_login text,
  is_demo boolean not null default true,
  symbol_name text,
  symbol_digits integer,
  contract_size numeric,
  volume_min numeric,
  volume_max numeric,
  volume_step numeric,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mt5_signal_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.mt5_devices(id) on delete cascade,
  symbol text not null default 'XAUUSD',
  signal_type text not null check (signal_type in ('BUY','SELL','BUY_LIMIT','SELL_LIMIT','CANCEL')),
  status text not null default 'PENDING' check (status in ('PENDING','CLAIMED','EXECUTED','REJECTED','EXPIRED','CANCELLED')),
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  execution_result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mt5_pairing_user_expiry_idx on public.mt5_pairing_codes(user_id, expires_at);
create index if not exists mt5_devices_user_enabled_idx on public.mt5_devices(user_id, enabled);
create index if not exists mt5_queue_user_status_idx on public.mt5_signal_queue(user_id, status, expires_at);

alter table public.mt5_pairing_codes enable row level security;
alter table public.mt5_devices enable row level security;
alter table public.mt5_signal_queue enable row level security;
-- No client-side policies: all access goes through the Edge Function using service role.
