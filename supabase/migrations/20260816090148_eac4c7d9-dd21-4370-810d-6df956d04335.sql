CREATE OR REPLACE FUNCTION public.auto_ban_shared_ip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ip text;
  _cnt integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  _ip := COALESCE(NEW.last_ip, NEW.signup_ip);
  IF _ip IS NULL OR length(btrim(_ip)) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO _cnt
  FROM public.profiles p
  WHERE COALESCE(p.last_ip, p.signup_ip) = _ip;

  IF _cnt > 5 THEN
    UPDATE public.profiles p
    SET banned = true,
        ban_reason = 'Multi-cuenta: más de 5 cuentas con la misma IP (' || _ip || ')',
        banned_at = now()
    WHERE COALESCE(p.last_ip, p.signup_ip) = _ip
      AND p.banned = false
      AND NOT public.has_role(p.user_id, 'admin'::app_role);

    IF NOT public.has_role(NEW.user_id, 'admin'::app_role) THEN
      NEW.banned := true;
      NEW.ban_reason := 'Multi-cuenta: más de 5 cuentas con la misma IP (' || _ip || ')';
      NEW.banned_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_ban_shared_ip ON public.profiles;
CREATE TRIGGER trg_auto_ban_shared_ip
BEFORE INSERT OR UPDATE OF last_ip, signup_ip ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.auto_ban_shared_ip();

REVOKE ALL ON FUNCTION public.auto_ban_shared_ip() FROM PUBLIC, anon, authenticated;