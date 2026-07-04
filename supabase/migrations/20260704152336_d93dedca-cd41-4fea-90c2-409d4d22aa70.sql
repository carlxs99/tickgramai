
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Mark pending deposits older than 24h as expired so they don't sit in
-- 'pending' forever. verify-deposits still creates the confirmed row on
-- chain, so this only cleans up abandoned intents.
CREATE OR REPLACE FUNCTION public.expire_stale_pending_deposits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.deposits
     SET status = 'expired'
   WHERE status = 'pending'
     AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_pending_deposits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_deposits() TO service_role;

-- One-off cleanup: expire the rows that are already stale.
SELECT public.expire_stale_pending_deposits();

-- Schedule: every 15 minutes.
SELECT cron.unschedule('expire-stale-pending-deposits')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-pending-deposits');

SELECT cron.schedule(
  'expire-stale-pending-deposits',
  '*/15 * * * *',
  $$ SELECT public.expire_stale_pending_deposits(); $$
);
