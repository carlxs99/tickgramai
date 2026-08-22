
CREATE OR REPLACE FUNCTION public.claim_payouts(_user_id uuid)
 RETURNS TABLE(gained numeric, days integer, new_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gained numeric := 0;
  v_days integer := 0;
  v_balance numeric;
  v_banned boolean;
BEGIN
  SELECT banned INTO v_banned FROM public.profiles WHERE user_id = _user_id FOR UPDATE;
  IF v_banned IS NULL THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
  IF v_banned THEN
    RAISE EXCEPTION 'account suspended';
  END IF;

  WITH upd AS (
    UPDATE public.payout_entries e
       SET claimed_at = now()
     WHERE e.user_id = _user_id AND e.claimed_at IS NULL
     RETURNING e.amount_gram
  )
  SELECT COALESCE(sum(amount_gram), 0), count(*) INTO v_gained, v_days FROM upd;

  IF v_gained > 0 THEN
    UPDATE public.profiles SET balance = balance + v_gained, updated_at = now()
     WHERE user_id = _user_id
     RETURNING balance INTO v_balance;
  ELSE
    SELECT balance INTO v_balance FROM public.profiles WHERE user_id = _user_id;
  END IF;

  gained := COALESCE(v_gained, 0);
  days := COALESCE(v_days, 0);
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION public.create_withdrawal_atomic(_user_id uuid, _amount numeric, _address text, _memo text, _fee numeric, _net_amount numeric)
 RETURNS TABLE(withdrawal_id uuid, new_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_withdrawal_id uuid;
  v_new_balance numeric;
  v_last timestamptz;
  v_prev_count integer;
  v_deposited numeric;
  v_banned boolean;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required';
  END IF;

  SELECT banned INTO v_banned FROM public.profiles WHERE user_id = _user_id;
  IF COALESCE(v_banned, false) THEN
    RAISE EXCEPTION 'account suspended';
  END IF;

  IF _amount IS NULL OR _amount < 1 THEN
    RAISE EXCEPTION 'minimum withdrawal is 1 GRAM';
  END IF;
  IF _fee IS NULL OR _fee < 0 OR _net_amount IS NULL OR _net_amount <= 0
     OR round((_fee + _net_amount)::numeric, 9) <> round(_amount::numeric, 9) THEN
    RAISE EXCEPTION 'invalid withdrawal totals';
  END IF;
  IF _address IS NULL OR length(btrim(_address)) < 10 OR length(btrim(_address)) > 80 THEN
    RAISE EXCEPTION 'invalid withdrawal address';
  END IF;
  IF _memo IS NOT NULL AND length(_memo) > 200 THEN
    RAISE EXCEPTION 'memo too long';
  END IF;

  SELECT max(w.created_at) INTO v_last
  FROM public.withdrawals w
  WHERE w.user_id = _user_id
    AND w.status NOT IN ('failed', 'refunded', 'rejected', 'cancelled')
    AND w.created_at > now() - interval '24 hours';

  IF v_last IS NOT NULL THEN
    RAISE EXCEPTION 'daily withdrawal limit reached:%',
      to_char(v_last + interval '24 hours', 'YYYY-MM-DD"T"HH24:MI:SSOF');
  END IF;

  SELECT count(*) INTO v_prev_count
  FROM public.withdrawals w
  WHERE w.user_id = _user_id
    AND w.status NOT IN ('failed', 'refunded', 'rejected', 'cancelled');

  IF v_prev_count >= 1 THEN
    -- Only REAL on-chain deposits count. Reinvested balance (tx_hash IS NULL)
    -- must not unlock further withdrawals.
    SELECT coalesce(sum(d.amount_ton), 0) INTO v_deposited
    FROM public.deposits d
    WHERE d.user_id = _user_id
      AND d.status = 'confirmed'
      AND d.tx_hash IS NOT NULL;

    IF v_deposited < 1 THEN
      RAISE EXCEPTION 'deposit required: minimum 1 GRAM deposit needed to withdraw again';
    END IF;
  END IF;

  UPDATE public.profiles
     SET balance = balance - _amount
   WHERE user_id = _user_id
     AND balance >= _amount
  RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'insufficient balance';
  END IF;

  INSERT INTO public.withdrawals (
    user_id, amount, address, memo, fee, net_amount, status
  ) VALUES (
    _user_id, _amount, btrim(_address), nullif(btrim(_memo), ''), _fee, _net_amount, 'pending'
  )
  RETURNING id INTO v_withdrawal_id;

  withdrawal_id := v_withdrawal_id;
  new_balance := v_new_balance;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_payouts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_withdrawal_atomic(uuid, numeric, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payouts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_withdrawal_atomic(uuid, numeric, text, text, numeric, numeric) TO service_role;
