
REVOKE EXECUTE ON FUNCTION public.award_gift_box_on_first_deposit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_gift_box_on_first_deposit() TO service_role;
