
REVOKE EXECUTE ON FUNCTION public.atomic_add_balance(uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.atomic_decrement_balance(uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.atomic_collect_income(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.atomic_collect_income_usd(uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_partner_task(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_top_miners(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_memo_tag() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_partner_memo() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.atomic_add_balance(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atomic_decrement_balance(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atomic_collect_income(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atomic_collect_income_usd(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_partner_task(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_top_miners(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_memo_tag() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_partner_memo() TO service_role;
