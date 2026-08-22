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
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
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

  -- One withdrawal per 24 hours. Failed/refunded attempts do not count.
  SELECT max(w.created_at) INTO v_last
  FROM public.withdrawals w
  WHERE w.user_id = _user_id
    AND w.status NOT IN ('failed', 'refunded', 'rejected', 'cancelled')
    AND w.created_at > now() - interval '24 hours';

  IF v_last IS NOT NULL THEN
    RAISE EXCEPTION 'daily withdrawal limit reached:%',
      to_char(v_last + interval '24 hours', 'YYYY-MM-DD"T"HH24:MI:SSOF');
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

REVOKE ALL ON FUNCTION public.create_withdrawal_atomic(uuid, numeric, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_withdrawal_atomic(uuid, numeric, text, text, numeric, numeric) TO service_role;