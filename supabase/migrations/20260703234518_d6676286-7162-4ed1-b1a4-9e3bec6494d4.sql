-- 1) partner_tasks
CREATE TABLE public.partner_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  link text NOT NULL,
  kind text NOT NULL DEFAULT 'link' CHECK (kind IN ('link','channel','group','bot')),
  target_clicks integer NOT NULL CHECK (target_clicks >= 250),
  current_clicks integer NOT NULL DEFAULT 0,
  reward_per_click numeric(20,6) NOT NULL DEFAULT 0.001,
  cost_ton numeric(20,6) NOT NULL,
  memo_tag text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','active','completed','cancelled')),
  tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.partner_tasks TO authenticated;
GRANT ALL ON public.partner_tasks TO service_role;
-- Inserts happen only via a server function using supabaseAdmin;
-- no client insert/update/delete grants.

ALTER TABLE public.partner_tasks ENABLE ROW LEVEL SECURITY;

-- Users can see all ACTIVE partner tasks (to complete them), and their own tasks in any state.
CREATE POLICY "partner_tasks read active or own" ON public.partner_tasks
  FOR SELECT TO authenticated
  USING (status = 'active' OR auth.uid() = owner_id);

CREATE TRIGGER t_partner_tasks_upd BEFORE UPDATE ON public.partner_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX partner_tasks_status_idx ON public.partner_tasks(status);
CREATE INDEX partner_tasks_owner_idx ON public.partner_tasks(owner_id);


-- 2) partner_task_completions
CREATE TABLE public.partner_task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_task_id uuid NOT NULL REFERENCES public.partner_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward numeric(20,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_task_id, user_id)
);

GRANT SELECT ON public.partner_task_completions TO authenticated;
GRANT ALL ON public.partner_task_completions TO service_role;

ALTER TABLE public.partner_task_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own partner completions read" ON public.partner_task_completions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX partner_completions_task_idx ON public.partner_task_completions(partner_task_id);
CREATE INDEX partner_completions_user_idx ON public.partner_task_completions(user_id);


-- 3) RPC to generate a unique short memo for partner tasks (PT + 8 chars).
CREATE OR REPLACE FUNCTION public.generate_partner_memo()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  candidate text;
  tries int := 0;
BEGIN
  LOOP
    candidate := 'PT' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.partner_tasks WHERE memo_tag = candidate);
    tries := tries + 1;
    IF tries > 20 THEN RAISE EXCEPTION 'could not generate unique memo'; END IF;
  END LOOP;
  RETURN candidate;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.generate_partner_memo() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.generate_partner_memo() TO service_role;


-- 4) Atomic completion: locks the partner task row, checks it is active and has
-- clicks left, inserts the completion (unique per user), credits the user, and
-- auto-completes the task when target is reached.
CREATE OR REPLACE FUNCTION public.complete_partner_task(_user_id uuid, _partner_task_id uuid)
RETURNS TABLE(reward numeric, new_balance numeric, remaining_clicks integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_owner uuid;
  t_target integer;
  t_current integer;
  t_reward numeric;
  t_status text;
  new_bal numeric;
BEGIN
  SELECT owner_id, target_clicks, current_clicks, reward_per_click, status
    INTO t_owner, t_target, t_current, t_reward, t_status
  FROM public.partner_tasks
  WHERE id = _partner_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner task not found';
  END IF;
  IF t_status <> 'active' THEN
    RAISE EXCEPTION 'task not active';
  END IF;
  IF t_owner = _user_id THEN
    RAISE EXCEPTION 'cannot complete your own task';
  END IF;
  IF t_current >= t_target THEN
    RAISE EXCEPTION 'task already fulfilled';
  END IF;

  -- Unique (partner_task_id, user_id) prevents double completion.
  INSERT INTO public.partner_task_completions (partner_task_id, user_id, reward)
  VALUES (_partner_task_id, _user_id, t_reward);

  UPDATE public.partner_tasks
     SET current_clicks = current_clicks + 1,
         status = CASE WHEN current_clicks + 1 >= target_clicks THEN 'completed' ELSE status END
   WHERE id = _partner_task_id
  RETURNING current_clicks INTO t_current;

  UPDATE public.profiles
     SET balance = balance + t_reward
   WHERE user_id = _user_id
  RETURNING balance INTO new_bal;

  reward := t_reward;
  new_balance := new_bal;
  remaining_clicks := t_target - t_current;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_partner_task(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.complete_partner_task(uuid, uuid) TO service_role;