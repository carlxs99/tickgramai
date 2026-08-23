
REVOKE EXECUTE ON FUNCTION public.leaderboard_top(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leaderboard_rank(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leaderboard_top(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.leaderboard_rank(uuid) TO service_role;
