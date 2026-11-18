create table if not exists public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 subscription jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions" on public.push_subscriptions
 for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.push_event_deliveries (
 id uuid primary key default gen_random_uuid(),
 event_key text not null unique,
 sent_at timestamptz not null default now()
);
alter table public.push_event_deliveries enable row level security;
