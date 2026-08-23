CREATE OR REPLACE FUNCTION public.leaderboard_top(_limit integer DEFAULT 100)
RETURNS TABLE(user_id uuid, username text, first_name text, avatar_url text, telegram_id bigint, hashrate numeric, mining_rate numeric, mining_rate_usd numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.username, p.first_name, p.avatar_url, p.telegram_id,
         h.points, p.mining_rate, p.mining_rate_usd
  FROM (
    SELECT g.user_id AS uid,
           COALESCE(SUM(
             g.points * GREATEST(0, LEAST(1,
               EXTRACT(EPOCH FROM (g.expires_at - now()))
               / NULLIF(EXTRACT(EPOCH FROM (g.expires_at - g.starts_at)), 0)
             ))
           ), 0)::numeric AS points
    FROM public.hashrate_grants g
    WHERE g.active AND g.expires_at > now()
    GROUP BY g.user_id
  ) h
  JOIN public.profiles p ON p.user_id = h.uid
  WHERE COALESCE(p.banned, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = h.uid AND r.role = 'admin'
    )
  ORDER BY h.points DESC
  LIMIT GREATEST(COALESCE(_limit, 100), 1);
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_rank(_user_id uuid)
RETURNS TABLE(rank integer, hashrate numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH agg AS (
    SELECT g.user_id AS uid,
           COALESCE(SUM(
             g.points * GREATEST(0, LEAST(1,
               EXTRACT(EPOCH FROM (g.expires_at - now()))
               / NULLIF(EXTRACT(EPOCH FROM (g.expires_at - g.starts_at)), 0)
             ))
           ), 0)::numeric AS points
    FROM public.hashrate_grants g
    WHERE g.active AND g.expires_at > now()
    GROUP BY g.user_id
  ),
  eligible AS (
    SELECT a.uid, a.points
    FROM agg a
    JOIN public.profiles p ON p.user_id = a.uid
    WHERE COALESCE(p.banned, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = a.uid AND r.role = 'admin'
      )
  ),
  me AS (
    SELECT COALESCE((SELECT points FROM agg WHERE uid = _user_id), 0) AS points
  )
  SELECT (
           SELECT COUNT(*)::int
           FROM eligible e, me
           WHERE e.uid <> _user_id AND e.points > me.points
         ) + 1,
         (SELECT points FROM me);
$$;

REVOKE EXECUTE ON FUNCTION public.leaderboard_top(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leaderboard_rank(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leaderboard_top(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.leaderboard_rank(uuid) TO service_role;