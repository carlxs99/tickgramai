CREATE OR REPLACE FUNCTION public.expire_stale_daily_gift_boxes(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.gift_boxes
     SET status = 'expired'
   WHERE user_id = _user_id
     AND source = 'daily'
     AND status = 'unopened'
     AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_daily_gift_box(_user_id uuid)
RETURNS TABLE(box_id uuid, next_claim_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  last_ts timestamptz;
  new_box_id uuid;
BEGIN
  SELECT last_daily_gift_at INTO last_ts
  FROM public.profiles
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF last_ts IS NOT NULL AND last_ts > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'daily gift box not available yet' USING ERRCODE = 'P0001';
  END IF;

  -- Daily boxes do not accumulate: anything unopened from a previous day is lost.
  UPDATE public.gift_boxes
     SET status = 'expired'
   WHERE user_id = _user_id
     AND source = 'daily'
     AND status = 'unopened';

  WITH inserted AS (
    INSERT INTO public.gift_boxes (user_id, source)
    VALUES (_user_id, 'daily'), (_user_id, 'daily'), (_user_id, 'daily')
    RETURNING id
  )
  SELECT id INTO new_box_id FROM inserted LIMIT 1;

  UPDATE public.profiles
     SET last_daily_gift_at = now()
   WHERE user_id = _user_id;

  box_id := new_box_id;
  next_claim_at := now() + interval '24 hours';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_gift_box(_user_id uuid, _box_id uuid)
RETURNS TABLE(prize_type text, prize_amount numeric, mining_rate_gram numeric, bonus_expires_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  b_status text;
  b_source text;
  b_created timestamptz;
  tier numeric;
  amount numeric;
  p_type text;
  low numeric;
  high numeric;
  new_rate_gram numeric;
  bonus_expires timestamptz;
  has_active_bonus boolean;
  gram_delta numeric;
BEGIN
  SELECT status, source, created_at INTO b_status, b_source, b_created
  FROM public.gift_boxes
  WHERE id = _box_id AND user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'gift box not found';
  END IF;
  IF b_status = 'expired' THEN
    RAISE EXCEPTION 'gift box expired';
  END IF;
  IF b_status <> 'unopened' THEN
    RAISE EXCEPTION 'gift box already opened';
  END IF;
  IF b_source = 'daily' AND b_created < now() - interval '24 hours' THEN
    UPDATE public.gift_boxes SET status = 'expired' WHERE id = _box_id;
    RAISE EXCEPTION 'gift box expired';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.deposit_bonuses
    WHERE user_id = _user_id
      AND used_at IS NULL
      AND expires_at > now()
  ) INTO has_active_bonus;

  IF has_active_bonus OR random() < 0.60 THEN
    p_type := 'gram_mining';
    tier := random();
    IF tier < 0.85 THEN
      low := 0.0000001; high := 0.000005;
    ELSIF tier < 0.98 THEN
      low := 0.000005; high := 0.00005;
    ELSE
      low := 0.00005; high := 0.0005;
    END IF;
    amount := low + random() * (high - low);
    amount := round(amount::numeric, 8);

    gram_delta := round((amount * 0.033)::numeric, 10);

    UPDATE public.profiles
       SET mining_rate = COALESCE(mining_rate, 0) + gram_delta,
           mining_rate_usd = COALESCE(mining_rate_usd, 0) + (gram_delta * 2.5)
     WHERE user_id = _user_id
    RETURNING mining_rate INTO new_rate_gram;
  ELSE
    p_type := 'deposit_bonus_pct';
    tier := random();
    IF tier < 0.85 THEN
      low := 1; high := 15;
    ELSIF tier < 0.97 THEN
      low := 15; high := 25;
    ELSE
      low := 25; high := 30;
    END IF;
    amount := low + random() * (high - low);
    amount := round(amount::numeric, 2);

    bonus_expires := now() + interval '24 hours';

    INSERT INTO public.deposit_bonuses (user_id, percent, source_gift_box_id, expires_at)
    VALUES (_user_id, amount, _box_id, bonus_expires);
  END IF;

  UPDATE public.gift_boxes
     SET status = 'opened',
         prize_type = p_type,
         prize_amount = amount,
         opened_at = now()
   WHERE id = _box_id;

  prize_type := p_type;
  prize_amount := amount;
  mining_rate_gram := new_rate_gram;
  bonus_expires_at := bonus_expires;
  RETURN NEXT;
END;
$$;