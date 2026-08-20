REVOKE ALL ON FUNCTION public.admin_detect_multi_accounts(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_deposit_promotion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_daily_gift_boxes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_referral_milestone(uuid, smallint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_detect_multi_accounts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_deposit_promotion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_daily_gift_boxes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_referral_milestone(uuid, smallint) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_referral_milestone(smallint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon, service_role;
