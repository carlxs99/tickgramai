
-- Revoke EXECUTE from PUBLIC and anon on all SECURITY DEFINER RPCs.
-- These functions are only called from authenticated server code.

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.atomic_collect_income(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.atomic_collect_income_usd(uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.atomic_add_balance(uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.atomic_decrement_balance(uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.atomic_add_mining_rate(uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.expire_stale_pending_deposits() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_task(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_partner_task(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.consume_active_deposit_bonus(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.open_gift_box(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_daily_gift_box(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_active_partner_tasks(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_top_miners(integer) FROM PUBLIC, anon;
