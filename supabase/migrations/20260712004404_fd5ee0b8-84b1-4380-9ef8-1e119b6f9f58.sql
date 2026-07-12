REVOKE EXECUTE ON FUNCTION public.expire_stale_pending_deposits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_deposits() TO service_role;