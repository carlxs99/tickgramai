CREATE OR REPLACE FUNCTION public.user_active_hashrate(_user_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(sum(
    g.points * GREATEST(0, LEAST(1,
      EXTRACT(EPOCH FROM (g.expires_at - now()))
      / NULLIF(EXTRACT(EPOCH FROM (g.expires_at - g.starts_at)), 0)))
  ), 0)::numeric
  FROM public.hashrate_grants g
  WHERE g.user_id = _user_id AND g.active AND g.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.network_active_hashrate()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(
    g.points * GREATEST(0, LEAST(1,
      EXTRACT(EPOCH FROM (g.expires_at - now()))
      / NULLIF(EXTRACT(EPOCH FROM (g.expires_at - g.starts_at)), 0)))
  ), 0)::numeric
  FROM public.hashrate_grants g
  JOIN public.profiles p ON p.user_id = g.user_id
  WHERE g.active AND g.expires_at > now() AND p.banned = false;
$$;

REVOKE ALL ON FUNCTION public.network_active_hashrate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.network_active_hashrate() TO service_role;
GRANT EXECUTE ON FUNCTION public.user_active_hashrate(uuid) TO authenticated, service_role;