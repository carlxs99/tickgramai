-- 1) Atomic + idempotent task completion with hashrate points
DROP FUNCTION IF EXISTS public.complete_task(uuid, uuid);

CREATE OR REPLACE FUNCTION public.complete_task(
  _user_id uuid,
  _task_id uuid,
  _points numeric DEFAULT 0,
  _days integer DEFAULT 180
)
RETURNS TABLE(reward numeric, completed_on date, points_granted numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t_reward numeric;
  t_kind text;
  t_active boolean;
  t_min numeric;
  today date := (now() AT TIME ZONE 'utc')::date;
  dep_total numeric;
  ut_id uuid;
BEGIN
  SELECT t.reward, t.kind, t.is_active, COALESCE(t.min_deposit, 0)
    INTO t_reward, t_kind, t_active, t_min
  FROM public.tasks t
  WHERE t.id = _task_id
  FOR SHARE;

  IF NOT FOUND OR NOT t_active THEN
    RAISE EXCEPTION 'task not available';
  END IF;

  IF t_min > 0 THEN
    SELECT COALESCE(p.deposit_total, 0) INTO dep_total
    FROM public.profiles p WHERE p.user_id = _user_id;
    IF COALESCE(dep_total, 0) < t_min THEN
      RAISE EXCEPTION 'deposit requirement not met';
    END IF;
  END IF;

  IF t_kind <> 'daily' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_tasks ut
      WHERE ut.user_id = _user_id AND ut.task_id = _task_id
    ) THEN
      RAISE EXCEPTION 'task already completed';
    END IF;
  END IF;

  INSERT INTO public.user_tasks (user_id, task_id, completed_on, reward)
  VALUES (_user_id, _task_id, today, t_reward)
  RETURNING id INTO ut_id;

  IF COALESCE(_points, 0) > 0 THEN
    PERFORM public.grant_hashrate(_user_id, _points, 'task', ut_id, COALESCE(_days, 180));
  END IF;

  reward := t_reward;
  completed_on := today;
  points_granted := GREATEST(COALESCE(_points, 0), 0);
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_task(uuid, uuid, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_task(uuid, uuid, numeric, integer) TO service_role;

-- 2) Backfill: task completions since 2026-08-22 that never received points
WITH gr AS (
  SELECT user_id, COUNT(*) AS granted
  FROM public.hashrate_grants
  WHERE source = 'task' AND created_at >= '2026-08-22'::date
  GROUP BY user_id
),
comp AS (
  SELECT ut.id, ut.user_id, ut.reward, ut.created_at,
         ROW_NUMBER() OVER (PARTITION BY ut.user_id ORDER BY ut.created_at DESC) AS rn
  FROM public.user_tasks ut
  WHERE ut.created_at >= '2026-08-22'::date
),
missing AS (
  SELECT c.user_id, SUM(c.reward) AS reward_sum
  FROM comp c
  LEFT JOIN gr ON gr.user_id = c.user_id
  WHERE c.rn > COALESCE(gr.granted, 0)
  GROUP BY c.user_id
)
INSERT INTO public.hashrate_grants (user_id, points, source, source_ref_id, expires_at)
SELECT m.user_id, m.reward_sum * 1.44375 * 100, 'task_backfill', NULL, now() + interval '180 days'
FROM missing m
WHERE m.reward_sum * 1.44375 * 100 > 0;