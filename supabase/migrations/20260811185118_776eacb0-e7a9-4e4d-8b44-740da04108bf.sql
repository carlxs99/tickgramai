REVOKE ALL ON FUNCTION public.expire_stale_daily_gift_boxes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_daily_gift_boxes(uuid) TO service_role;