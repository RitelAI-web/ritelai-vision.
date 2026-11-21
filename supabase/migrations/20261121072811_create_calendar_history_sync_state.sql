create table if not exists public.calendar_sync_state (
  id text primary key,
  last_history_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.calendar_sync_state enable row level security;
revoke all on table public.calendar_sync_state from anon, authenticated;
grant all on table public.calendar_sync_state to service_role;
