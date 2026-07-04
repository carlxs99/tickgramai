CREATE OR REPLACE FUNCTION public.complete_task(_user_id uuid, _task_id uuid)
 RETURNS TABLE(reward numeric, completed_on date)
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
  VALUES (_user_id, _task_id, today, t_reward);

  reward := t_reward;
  completed_on := today;
  RETURN NEXT;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_task(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_task(uuid, uuid) TO service_role;