-- deposits: explicit deny for direct writes
CREATE POLICY "deposits_deny_insert" ON public.deposits FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "deposits_deny_update" ON public.deposits FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deposits_deny_delete" ON public.deposits FOR DELETE TO anon, authenticated USING (false);

-- withdrawals: explicit deny for direct writes
CREATE POLICY "withdrawals_deny_insert" ON public.withdrawals FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "withdrawals_deny_update" ON public.withdrawals FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "withdrawals_deny_delete" ON public.withdrawals FOR DELETE TO anon, authenticated USING (false);

-- partner_task_completions: explicit deny for direct writes
CREATE POLICY "ptc_deny_insert" ON public.partner_task_completions FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "ptc_deny_update" ON public.partner_task_completions FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "ptc_deny_delete" ON public.partner_task_completions FOR DELETE TO anon, authenticated USING (false);

-- user_tasks: explicit deny for update/delete
CREATE POLICY "user_tasks_deny_update" ON public.user_tasks FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "user_tasks_deny_delete" ON public.user_tasks FOR DELETE TO anon, authenticated USING (false);