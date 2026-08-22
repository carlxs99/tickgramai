CREATE OR REPLACE FUNCTION public.open_gift_box(_user_id uuid, _box_id uuid)
 RETURNS TABLE(prize_type text, prize_amount numeric, mining_rate_gram numeric, bonus_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b_status text;
  b_source text;
  b_created timestamptz;
  tier numeric;
  amount numeric;
  p_type text;
  low numeric;
  high numeric;
  days integer;
  hash_chance numeric;
  new_rate_gram numeric;
  bonus_expires timestamptz;
  has_active_bonus boolean;
  capital_usd numeric;
  daily_usd numeric;
  gram_delta numeric;
BEGIN
  SELECT status, source, created_at INTO b_status, b_source, b_created
  FROM public.gift_boxes
  WHERE id = _box_id AND user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'gift box not found'; END IF;
  IF b_status = 'expired' THEN RAISE EXCEPTION 'gift box expired'; END IF;
  IF b_status <> 'unopened' THEN RAISE EXCEPTION 'gift box already opened'; END IF;
  IF b_source = 'daily' AND b_created < now() - interval '24 hours' THEN
    UPDATE public.gift_boxes SET status = 'expired' WHERE id = _box_id;
    RAISE EXCEPTION 'gift box expired';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.deposit_bonuses
    WHERE user_id = _user_id AND used_at IS NULL AND expires_at > now()
  ) INTO has_active_bonus;

  -- Free daily boxes are intentionally small: they must not dilute the
  -- mining pool of real depositors. Referral / wheel boxes pay much more.
  IF b_source = 'daily' THEN
    hash_chance := 0.35;
    days := 30;
  ELSE
    hash_chance := 0.55;
    days := 180;
  END IF;

  IF has_active_bonus OR random() < hash_chance THEN
    p_type := 'gram_mining';
    tier := random();
    IF b_source = 'daily' THEN
      IF tier < 0.85 THEN low := 0.2; high := 2;
      ELSIF tier < 0.98 THEN low := 2; high := 8;
      ELSE low := 8; high := 30;
      END IF;
    ELSE
      IF tier < 0.85 THEN low := 2; high := 15;
      ELSIF tier < 0.98 THEN low := 15; high := 50;
      ELSE low := 50; high := 200;
      END IF;
    END IF;

    -- prize_amount is now expressed directly in mining points (100 pts = $1 of capital)
    amount := round((low + random() * (high - low))::numeric, 2);

    capital_usd := amount / 100.0;
    daily_usd := capital_usd * 0.033;
    gram_delta := round((daily_usd / 2.5)::numeric, 10);

    UPDATE public.profiles
       SET mining_rate = COALESCE(mining_rate, 0) + gram_delta,
           mining_rate_usd = COALESCE(mining_rate_usd, 0) + daily_usd
     WHERE user_id = _user_id
    RETURNING mining_rate INTO new_rate_gram;

    PERFORM public.grant_hashrate(_user_id, amount, 'gift_box', _box_id, days);
  ELSE
    p_type := 'deposit_bonus_pct';
    tier := random();
    IF tier < 0.85 THEN low := 5; high := 15;
    ELSIF tier < 0.97 THEN low := 15; high := 25;
    ELSE low := 25; high := 40;
    END IF;
    amount := round((low + random() * (high - low))::numeric, 2);

    bonus_expires := now() + interval '24 hours';
    INSERT INTO public.deposit_bonuses (user_id, percent, source_gift_box_id, expires_at)
    VALUES (_user_id, amount, _box_id, bonus_expires);
  END IF;

  UPDATE public.gift_boxes
     SET status = 'opened', prize_type = p_type, prize_amount = amount, opened_at = now()
   WHERE id = _box_id;

  prize_type := p_type;
  prize_amount := amount;
  mining_rate_gram := new_rate_gram;
  bonus_expires_at := bonus_expires;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.open_gift_box(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_gift_box(uuid, uuid) TO service_role;