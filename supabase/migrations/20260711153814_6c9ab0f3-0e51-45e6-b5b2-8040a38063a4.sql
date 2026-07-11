
-- Revoke EXECUTE on sensitive SECURITY DEFINER functions from anon / authenticated / PUBLIC.
-- Server functions call these via the service-role admin client, which is unaffected.
DO $$
DECLARE
  fn text;
  sensitive text[] := ARRAY[
    'atomic_collect_income(uuid)',
    'atomic_collect_income_usd(uuid, numeric)',
    'atomic_decrement_balance(uuid, numeric)',
    'atomic_add_balance(uuid, numeric)',
    'atomic_add_mining_rate(uuid, numeric, numeric, numeric)',
    'open_gift_box(uuid, uuid)',
    'claim_daily_gift_box(uuid)',
    'consume_active_deposit_bonus(uuid)',
    'complete_task(uuid, uuid)',
    'complete_partner_task(uuid, uuid)',
    'get_referral_ancestors(uuid)',
    'get_referral_stats(uuid)',
    'get_top_miners(integer)',
    'expire_stale_pending_deposits()',
    'award_gift_box_on_first_deposit()',
    'generate_memo_tag()',
    'generate_partner_memo()',
    'list_active_partner_tasks(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY sensitive LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

-- has_role stays executable by authenticated (used inside RLS policies).
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
