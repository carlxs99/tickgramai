
CREATE OR REPLACE FUNCTION public._set_cron_secret(_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'cron_secret';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(_value, 'cron_secret', 'Bearer token for pg_cron -> /api/public/hooks/* broadcast endpoints');
  ELSE
    PERFORM vault.update_secret(existing_id, _value, 'cron_secret', 'Bearer token for pg_cron -> /api/public/hooks/* broadcast endpoints');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._set_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._set_cron_secret(text) TO service_role;
