
-- Restrict partner_tasks direct reads to owners only; expose safe columns of active tasks via a SECURITY DEFINER function.
DROP POLICY IF EXISTS "partner_tasks read active or own" ON public.partner_tasks;

CREATE POLICY "partner_tasks owner can read"
ON public.partner_tasks
FOR SELECT
TO authenticated
USING (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.list_active_partner_tasks(_user_id uuid)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  title text,
  link text,
  kind text,
  target_clicks integer,
  current_clicks integer,
  reward_per_click numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pt.id, pt.owner_id, pt.title, pt.link, pt.kind,
         pt.target_clicks, pt.current_clicks, pt.reward_per_click, pt.status
  FROM public.partner_tasks pt
  WHERE pt.status = 'active'
    AND pt.owner_id <> _user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.partner_task_completions c
      WHERE c.partner_task_id = pt.id AND c.user_id = _user_id
    )
  ORDER BY pt.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.list_active_partner_tasks(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_partner_tasks(uuid) TO authenticated;
