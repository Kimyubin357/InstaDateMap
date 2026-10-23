-- Run after migration 005 and after deploying /api/jobs/push.
-- In Supabase Vault create datemap_app_url (https://your-deployment)
-- and datemap_cron_secret (the SAME random value as server CRON_SECRET).
-- Do not commit secret values or put them directly in cron.job commands.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='datemap_app_url' and decrypted_secret like 'https://%')
    or not exists(select 1 from vault.decrypted_secrets where name='datemap_cron_secret' and length(decrypted_secret)>=32) then
    raise exception 'Create datemap_app_url and datemap_cron_secret in Vault first';
  end if;
end $$;

-- Named jobs are updated on rerun, rather than creating duplicate schedules.
select cron.schedule('datemap-push-retry','*/5 * * * *', $job$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='datemap_app_url'),'/') || '/api/jobs/push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='datemap_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 55000
  );
$job$);
select cron.schedule('datemap-recover-links','* * * * *', $job$
  select public.dm_recover_sources(id) from public.boards;
$job$);
