-- Atomic 30-day analysis quota enforcement for RitelAI Vision.
-- Run with Supabase CLI: supabase db push
create or replace function public.consume_analysis_quota(
  p_user_id uuid,
  p_asset text,
  p_timeframe text,
  p_result jsonb
)
returns table(allowed boolean, used integer, quota integer, plan_code text, is_owner boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_plan_code text := 'free';
  v_plan_quota integer := 5;
  v_used integer := 0;
  v_is_owner boolean := false;
begin
  if p_user_id is null then
    raise exception 'user_id wajib diisi';
  end if;

  -- Serialize requests per user so simultaneous analyses cannot exceed quota.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select lower(coalesce(role, ''))
    into v_role
    from public.profiles
   where id = p_user_id;

  v_is_owner := v_role in ('owner', 'admin', 'super_admin');

  select lower(p.code), coalesce(p.analysis_quota, 0)
    into v_plan_code, v_plan_quota
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
   where s.user_id = p_user_id
     and s.status = 'active'
     and s.ends_at > now()
   order by s.ends_at desc
   limit 1;

  if not found then
    select lower(code), coalesce(analysis_quota, 5)
      into v_plan_code, v_plan_quota
      from public.plans
     where lower(code) = 'free' and is_active = true
     limit 1;
    if not found then
      v_plan_code := 'free';
      v_plan_quota := 5;
    end if;
  end if;

  if v_plan_code = 'free' then v_plan_quota := 5; end if;
  if v_plan_code = 'starter' then v_plan_quota := 20; end if;

  select count(*)::integer
    into v_used
    from public.analysis_history
   where user_id = p_user_id
     and created_at >= now() - interval '30 days';

  if not v_is_owner and (v_plan_quota <= 0 or v_used >= v_plan_quota) then
    return query select false, v_used, greatest(v_plan_quota, 0), coalesce(v_plan_code, 'free'), v_is_owner;
    return;
  end if;

  insert into public.analysis_history(user_id, asset, timeframe, result)
  values (p_user_id, left(coalesce(p_asset, 'UNKNOWN'), 24),
          left(coalesce(p_timeframe, 'UNKNOWN'), 12), coalesce(p_result, '{}'::jsonb));

  if not v_is_owner then v_used := v_used + 1; end if;
  return query select true, v_used, greatest(v_plan_quota, 0), coalesce(v_plan_code, 'free'), v_is_owner;
end;
$$;

revoke all on function public.consume_analysis_quota(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.consume_analysis_quota(uuid, text, text, jsonb) to service_role;
