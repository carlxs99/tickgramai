-- Defense in depth: previously every public table had ALL privileges granted to
-- anon and authenticated; only RLS stood between users and their own balance.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Public catalogue of active tasks (policy "tasks public read" targets public).
GRANT SELECT ON public.tasks TO anon;

-- Users create their own profile row and may only edit their wallet address.
GRANT INSERT ON public.profiles TO authenticated;
GRANT UPDATE (wallet_address) ON public.profiles TO authenticated;

-- Admins manage tasks (guarded by has_role policies).
GRANT INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
