
-- Revoke public EXECUTE on SECURITY DEFINER functions; only service_role should call them.
-- has_role is used inside RLS policies (runs as function owner), so keeping it callable by authenticated is fine,
-- but we still revoke from anon/public to be safe.

DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'atomic_collect_income(uuid)',
    'atomic_collect_income_usd(uuid,numeric)',
    'atomic_add_balance(uuid,numeric)',
    'atomic_decrement_balance(uuid,numeric)',
    'atomic_add_mining_rate(uuid,numeric,numeric,numeric)',
    'complete_partner_task(uuid,uuid)',
    'get_top_miners(integer)',
    'expire_stale_pending_deposits()',
    'generate_memo_tag()',
    'generate_partner_memo()'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;

  -- has_role is used by RLS policies; keep it callable by authenticated but not anon.
  EXECUTE 'REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role';

  -- update_updated_at_column is a trigger function; revoke from public.
  EXECUTE 'REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated';
END $$;
