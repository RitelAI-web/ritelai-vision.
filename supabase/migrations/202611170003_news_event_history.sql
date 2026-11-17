-- News History: per-user snapshots for Pro and Elite.
create table if not exists public.news_event_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  checkpoint_minutes integer not null check (checkpoint_minutes in (0,1,2,5,15,30)),
  event_time timestamptz not null,
  captured_at timestamptz not null default now(),
  event_snapshot jsonb not null default '{}'::jsonb,
  ai_snapshot jsonb not null default '{}'::jsonb,
  quotes_snapshot jsonb not null default '{}'::jsonb,
  validation_status text not null default 'PENDING' check (validation_status in ('PENDING','PARTIAL','VALIDATED')),
  execution_type text not null default 'AI_SIGNAL' check (execution_type in ('AI_SIGNAL','SIMULATED_ENTRY','EA_EXECUTED')),
  outcome text not null default 'UNVERIFIED' check (outcome in ('UNVERIFIED','CORRECT','WRONG','MIXED','NO_SIGNAL')),
  created_at timestamptz not null default now(),
  unique(user_id,event_id,checkpoint_minutes)
);
create index if not exists news_event_history_user_time_idx
  on public.news_event_history(user_id,event_time desc);
alter table public.news_event_history enable row level security;
-- Access is mediated by the news-history Edge Function using the service role
-- after validating the caller's JWT and active Pro/Elite subscription.
drop policy if exists "news history owner read" on public.news_event_history;
drop policy if exists "news history owner write" on public.news_event_history;
