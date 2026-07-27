REVOKE ALL ON FUNCTION public.get_active_deposit_promotion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_deposit_promotion() TO service_role;