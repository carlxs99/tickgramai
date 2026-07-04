
-- 1) partner_tasks: explicit deny for authenticated writes; service_role (server) still bypasses RLS.
CREATE POLICY "partner_tasks deny insert"
ON public.partner_tasks
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "partner_tasks deny update"
ON public.partner_tasks
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "partner_tasks deny delete"
ON public.partner_tasks
FOR DELETE
TO authenticated
USING (false);

-- 2) user_tasks: remove permissive client-side insert policy and route all completions through
-- a SECURITY DEFINER function that atomically validates task state, deposit gating, and
-- prevents duplicate rewards for non-daily tasks.
DROP POLICY IF EXISTS "own user_tasks insert" ON public.user_tasks;

CREATE POLICY "user_tasks deny direct insert"
ON public.user_tasks
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.complete_task(_user_id uuid, _task_id uuid)
RETURNS TABLE(reward numeric, completed_on date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_reward numeric;
  t_kind text;
  t_active boolean;
  t_min numeric;
  today date := (now() AT TIME ZONE 'utc')::date;
  deposit_total numeric;
BEGIN
  SELECT reward, kind, is_active, COALESCE(min_deposit, 0)
    INTO t_reward, t_kind, t_active, t_min
  FROM public.tasks
  WHERE id = _task_id
  FOR SHARE;

  IF NOT FOUND OR NOT t_active THEN
    RAISE EXCEPTION 'task not available';
  END IF;

  IF t_min > 0 THEN
    SELECT COALESCE(p.deposit_total, 0) INTO deposit_total
    FROM public.profiles p WHERE p.user_id = _user_id;
    IF COALESCE(deposit_total, 0) < t_min THEN
      RAISE EXCEPTION 'deposit requirement not met';
    END IF;
  END IF;

  -- One-time (non-daily) tasks: reject if any completion already exists.
  IF t_kind <> 'daily' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_tasks
      WHERE user_id = _user_id AND task_id = _task_id
    ) THEN
      RAISE EXCEPTION 'task already completed';
    END IF;
  END IF;

  -- Daily tasks: unique (user_id, task_id, completed_on) enforces one per day.
  INSERT INTO public.user_tasks (user_id, task_id, completed_on, reward)
  VALUES (_user_id, _task_id, today, t_reward);

  reward := t_reward;
  completed_on := today;
  RETURN NEXT;
END;
$$;

-- 3) Lock down EXECUTE on every SECURITY DEFINER function in public: no anon, no PUBLIC.
-- Trigger functions (award_gift_box_on_first_deposit) do not need EXECUTE grants either.
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.atomic_collect_income(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_stale_pending_deposits() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.award_gift_box_on_first_deposit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atomic_add_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atomic_decrement_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_top_miners(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.atomic_add_mining_rate(uuid, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_active_deposit_bonus(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_gift_box(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atomic_collect_income_usd(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_active_partner_tasks(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_partner_task(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Re-grant EXECUTE only to authenticated (and service_role, which retains it) where needed.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_miners(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_collect_income(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_collect_income_usd(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_partner_tasks(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_task(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_task(uuid, uuid) TO service_role;
