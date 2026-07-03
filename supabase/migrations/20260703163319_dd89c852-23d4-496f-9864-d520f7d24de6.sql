
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS link text,
  ADD COLUMN IF NOT EXISTS target_chat text;

-- Grant admin role to telegram user 6334940213
INSERT INTO public.user_roles (user_id, role)
SELECT p.user_id, 'admin'::app_role
FROM public.profiles p
WHERE p.telegram_id = 6334940213
ON CONFLICT (user_id, role) DO NOTHING;

-- Admin write policies on tasks
DROP POLICY IF EXISTS "tasks admin insert" ON public.tasks;
DROP POLICY IF EXISTS "tasks admin update" ON public.tasks;
DROP POLICY IF EXISTS "tasks admin delete" ON public.tasks;

CREATE POLICY "tasks admin insert" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "tasks admin update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "tasks admin delete" ON public.tasks
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Let admins read all tasks (including inactive) via a broader read policy
DROP POLICY IF EXISTS "tasks admin read all" ON public.tasks;
CREATE POLICY "tasks admin read all" ON public.tasks
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
