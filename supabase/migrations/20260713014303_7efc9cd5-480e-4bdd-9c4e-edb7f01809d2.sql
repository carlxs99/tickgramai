REVOKE EXECUTE ON FUNCTION public.claim_referral_milestone(smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral_milestone(smallint) TO service_role;