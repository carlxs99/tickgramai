
-- Atomic balance decrement with balance check. Returns new balance, or NULL if insufficient.
CREATE OR REPLACE FUNCTION public.atomic_decrement_balance(_user_id uuid, _amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
BEGIN
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  UPDATE public.profiles
     SET balance = balance - _amount
   WHERE user_id = _user_id
     AND balance >= _amount
  RETURNING balance INTO new_balance;
  RETURN new_balance;
END;
$$;

-- Atomic balance add. Returns new balance.
CREATE OR REPLACE FUNCTION public.atomic_add_balance(_user_id uuid, _amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
BEGIN
  IF _amount < 0 THEN
    RAISE EXCEPTION 'amount must be non-negative';
  END IF;
  UPDATE public.profiles
     SET balance = balance + _amount
   WHERE user_id = _user_id
  RETURNING balance INTO new_balance;
  RETURN new_balance;
END;
$$;

-- Atomic collect: compute pending income based on mining_rate and last_collect_at,
-- add it to balance, reset last_collect_at. Row is locked for the duration.
CREATE OR REPLACE FUNCTION public.atomic_collect_income(_user_id uuid)
RETURNS TABLE(gained numeric, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rate numeric;
  last_ts timestamptz;
  seconds numeric;
  earned numeric;
  bal numeric;
BEGIN
  SELECT mining_rate, last_collect_at, balance
    INTO rate, last_ts, bal
    FROM public.profiles
   WHERE user_id = _user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  seconds := GREATEST(0, EXTRACT(EPOCH FROM (now() - last_ts)));
  earned  := (COALESCE(rate, 0) / 86400) * seconds;

  UPDATE public.profiles
     SET balance = balance + earned,
         last_collect_at = now()
   WHERE user_id = _user_id
  RETURNING balance INTO bal;

  gained := earned;
  new_balance := bal;
  RETURN NEXT;
END;
$$;

-- Only service_role can call these; user code goes through server functions.
REVOKE EXECUTE ON FUNCTION public.atomic_decrement_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_add_balance(uuid, numeric)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_collect_income(uuid)             FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_decrement_balance(uuid, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.atomic_add_balance(uuid, numeric)       TO service_role;
GRANT  EXECUTE ON FUNCTION public.atomic_collect_income(uuid)             TO service_role;
