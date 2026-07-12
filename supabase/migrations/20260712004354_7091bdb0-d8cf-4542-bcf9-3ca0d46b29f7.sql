CREATE OR REPLACE FUNCTION public.expire_stale_pending_deposits()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE public.deposits
     SET status = 'expired'
   WHERE status = 'pending'
     AND created_at < now() - interval '15 minutes';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;