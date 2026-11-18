create or replace function public.verify_news_push_cron_secret(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (select decrypted_secret = p_token
     from vault.decrypted_secrets
     where name = 'ritelai_news_push_cron_secret'
     limit 1),
    false
  );
$$;

revoke all on function public.verify_news_push_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_news_push_cron_secret(text) to service_role;

create or replace function public.get_news_push_vapid_private_key()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'ritelai_news_push_vapid_private_key'
  limit 1;
$$;

revoke all on function public.get_news_push_vapid_private_key() from public, anon, authenticated;
grant execute on function public.get_news_push_vapid_private_key() to service_role;
