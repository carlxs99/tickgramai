-- 1) Block direct client inserts on withdrawals (exploit): server functions
-- use the service role and bypass RLS, so dropping this policy does not
-- affect legitimate flows. Without a matching INSERT policy, RLS denies
-- all client inserts by default.
DROP POLICY IF EXISTS "own withdrawals insert" ON public.withdrawals;

-- 2) Block direct client inserts on deposits (cosmetic cleanup):
-- deposits are only recorded server-side (verify-deposits + reinvest).
DROP POLICY IF EXISTS "own deposits insert" ON public.deposits;

-- 3) Allow users to update ONLY their wallet_address on their own profile.
-- All other columns (balance, mining_rate, deposit_total, memo_tag,
-- referred_by, referral_code, telegram_id, is_premium) remain untouchable
-- from the client. Server functions with supabaseAdmin bypass this.
GRANT UPDATE (wallet_address, username, first_name, last_name, avatar_url, language_code)
  ON public.profiles TO authenticated;

CREATE POLICY "own profile update wallet"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
