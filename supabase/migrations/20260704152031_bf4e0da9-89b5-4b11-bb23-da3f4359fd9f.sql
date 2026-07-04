
-- Atomic mining_rate / deposit_total increments to prevent lost-update races
-- when completeTask, reinvestBalance and verify-deposits run concurrently.
CREATE OR REPLACE FUNCTION public.atomic_add_mining_rate(
  _user_id uuid,
  _add_rate_usd numeric,
  _add_rate_gram numeric,
  _add_deposit_ton numeric DEFAULT 0
)
RETURNS TABLE(new_rate_usd numeric, new_rate_gram numeric, new_deposit_total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET mining_rate_usd = COALESCE(mining_rate_usd, 0) + _add_rate_usd,
         mining_rate     = COALESCE(mining_rate, 0)     + _add_rate_gram,
         deposit_total   = COALESCE(deposit_total, 0)   + _add_deposit_ton
   WHERE user_id = _user_id
  RETURNING mining_rate_usd, mining_rate, deposit_total
  INTO new_rate_usd, new_rate_gram, new_deposit_total;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_add_mining_rate(uuid, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atomic_add_mining_rate(uuid, numeric, numeric, numeric) TO service_role;

-- Tighten user_tasks INSERT: the client can no longer insert an arbitrary
-- reward value — the reward must match the active task's reward.
DROP POLICY IF EXISTS "own user_tasks insert" ON public.user_tasks;
CREATE POLICY "own user_tasks insert"
ON public.user_tasks
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = user_tasks.task_id
      AND t.is_active = true
      AND t.reward = user_tasks.reward
  )
);
