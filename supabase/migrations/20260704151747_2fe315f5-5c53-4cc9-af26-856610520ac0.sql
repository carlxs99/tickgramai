
-- Remove the overly-permissive UPDATE policy that let authenticated users
-- change ANY column of their own profile (including balance, mining_rate,
-- mining_rate_usd, deposit_total, referred_by, memo_tag, referral_code).
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
DROP POLICY IF EXISTS "own profile update wallet" ON public.profiles;

-- Column-level UPDATE grant: even if RLS allowed the row, the user can only
-- write to wallet_address. All other economic fields are server-only
-- (edited via supabaseAdmin in server functions).
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (wallet_address) ON public.profiles TO authenticated;

CREATE POLICY "own profile update wallet"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
