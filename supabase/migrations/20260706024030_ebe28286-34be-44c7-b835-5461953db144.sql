
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_daily_gift_at timestamptz;

-- Claim a free daily gift box (24h cooldown).
CREATE OR REPLACE FUNCTION public.claim_daily_gift_box(_user_id uuid)
RETURNS TABLE(box_id uuid, next_claim_at timestamptz)
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

  INSERT INTO public.gift_boxes (user_id, source)
  VALUES (_user_id, 'daily')
  RETURNING id INTO new_box_id;

  UPDATE public.profiles
     SET last_daily_gift_at = now()
   WHERE user_id = _user_id;

  box_id := new_box_id;
  next_claim_at := now() + interval '24 hours';
  RETURN NEXT;
END;
$$;

-- Update open_gift_box so gram prizes apply as a 3.3% daily ROI.
CREATE OR REPLACE FUNCTION public.open_gift_box(_user_id uuid, _box_id uuid)
 RETURNS TABLE(prize_type text, prize_amount numeric, mining_rate_gram numeric, bonus_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b_status text;
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
  SELECT status INTO b_status
  FROM public.gift_boxes
  WHERE id = _box_id AND user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'gift box not found';
  END IF;
  IF b_status <> 'unopened' THEN
    RAISE EXCEPTION 'gift box already opened';
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
      low := 0.000001; high := 0.0001;
    ELSIF tier < 0.98 THEN
      low := 0.0001; high := 0.001;
    ELSE
      low := 0.001; high := 1.0;
    END IF;
    amount := low + random() * (high - low);
    amount := round(amount::numeric, 8);

    -- Apply 3.3% daily ROI: the prize represents a virtual deposit,
    -- and the user's mining rate grows by 3.3% of the prize per day.
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
$function$;
