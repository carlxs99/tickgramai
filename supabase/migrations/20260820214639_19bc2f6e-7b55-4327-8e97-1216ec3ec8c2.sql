REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

CREATE POLICY "admins read all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));