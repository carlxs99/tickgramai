DROP POLICY IF EXISTS "own deposits insert" ON public.deposits;
CREATE POLICY "own deposits insert" ON public.deposits
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND COALESCE(gram_per_day, 0) = 0
  AND tx_hash IS NULL
);

DROP POLICY IF EXISTS "own withdrawals insert" ON public.withdrawals;
CREATE POLICY "own withdrawals insert" ON public.withdrawals
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND COALESCE(fee, 0) = 0
  AND COALESCE(net_amount, 0) = 0
  AND tx_hash IS NULL
);