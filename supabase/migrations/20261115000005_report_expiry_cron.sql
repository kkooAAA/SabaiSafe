-- SabaiSafe: delete expired reports daily at 03:00 UTC (PDPA, 30-day retention). Owner: backend. §2.6.
-- cron.schedule with an existing job name replaces that job (pg_cron >= 1.4), so this is re-runnable.
-- lib/db/reports.ts also deletes expired rows on each insert as a fallback.
select cron.schedule(
  'delete-expired-reports',
  '0 3 * * *',
  $$delete from public.reports where expires_at < now()$$
);
