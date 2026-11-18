select cron.schedule(
  'ritelai-news-push-every-5m',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://brfssdpplapefjmxnpft.supabase.co/functions/v1/news-push',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'apikey','sb_publishable_h4AVI-fQH6ki1Op8nxh60g_PuXiqEur',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='ritelai_news_push_cron_secret' limit 1)
      ),
      body := '{"action":"dispatch"}'::jsonb,
      timeout_milliseconds := 35000
    ) as request_id;
  $job$
) as scheduled_job_id;
