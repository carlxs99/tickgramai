-- Hardening: remove redundant client-side write grants.
-- All completions/referral writes must go through SECURITY DEFINER RPCs
-- or the service_role in server functions.

REVOKE INSERT, UPDATE, DELETE ON public.user_tasks FROM authenticated;
GRANT SELECT ON public.user_tasks TO authenticated;

DROP POLICY IF EXISTS "Users can insert their own task completions" ON public.user_tasks;

REVOKE INSERT, UPDATE, DELETE ON public.referrals FROM authenticated;
GRANT SELECT ON public.referrals TO authenticated;