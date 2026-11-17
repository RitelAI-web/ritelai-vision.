-- RitelAI demo execution controls and atomic signal claiming.
-- Apply after 202611160001_mt5_bridge.sql.
alter table public.mt5_devices
  add column if not exists execution_mode text not null default 'SEMI_AUTO'
    check (execution_mode in ('SEMI_AUTO','FULL_AUTO')),
  add column if not exists emergency_stop boolean not null default true,
  add column if not exists max_risk_pct numeric not null default 0.5
    check (max_risk_pct > 0 and max_risk_pct <= 1),
  add column if not exists max_daily_loss_pct numeric not null default 2
    check (max_daily_loss_pct > 0 and max_daily_loss_pct <= 3),
  add column if not exists max_spread_points integer not null default 80
    check (max_spread_points between 1 and 500),
  add column if not exists max_open_positions integer not null default 1
    check (max_open_positions between 1 and 3);

-- Signals are claimed once so repeated polling cannot trigger duplicate execution.
create or replace function public.claim_mt5_signals(p_device_id uuid)
returns setof public.mt5_signal_queue
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id
    from public.mt5_signal_queue
    where device_id = p_device_id
      and status = 'PENDING'
      and expires_at > now()
    order by created_at asc
    for update skip locked
    limit 5
  )
  update public.mt5_signal_queue q
     set status = 'CLAIMED', claimed_at = now()
    from picked
   where q.id = picked.id
  returning q.*;
$$;

revoke all on function public.claim_mt5_signals(uuid) from public, anon, authenticated;
grant execute on function public.claim_mt5_signals(uuid) to service_role;
