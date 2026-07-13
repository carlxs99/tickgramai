
REVOKE EXECUTE ON FUNCTION public.list_referral_milestones(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_referral_milestone(uuid, smallint) FROM authenticated;
