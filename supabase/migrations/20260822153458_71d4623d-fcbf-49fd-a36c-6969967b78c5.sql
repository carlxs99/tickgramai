-- Wheel prizes also grant mining power under economy v2.
CREATE OR REPLACE FUNCTION public.spin_wheel(_user_id uuid, _gram_price numeric DEFAULT 1)
 RETURNS TABLE(prize_type text, prize_amount numeric, spins_left integer, new_mining_rate numeric, bonus_expires_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  s_id uuid;
  r numeric;
  p_type text;
  amount numeric;
  gram_delta numeric;
  new_rate numeric;
  bonus_exp timestamptz;
  price numeric := GREATEST(COALESCE(_gram_price, 1), 0.01);
BEGIN
  PERFORM public.expire_stale_wheel_spins(_user_id);

  SELECT id INTO s_id
  FROM public.wheel_spins
  WHERE user_id = _user_id AND status = 'available' AND expires_at > now()
  ORDER BY expires_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF s_id IS NULL THEN
    RAISE EXCEPTION 'no spins available' USING ERRCODE = 'P0001';
  END IF;

  r := random();

  IF r < 0.4005 THEN p_type := 'gram_mining'; amount := 0.1;
  ELSIF r < 0.6205 THEN p_type := 'gram_mining'; amount := 0.2;
  ELSIF r < 0.7405 THEN p_type := 'gram_mining'; amount := 0.3;
  ELSIF r < 0.8005 THEN p_type := 'gram_mining'; amount := 0.5;
  ELSIF r < 0.8205 THEN p_type := 'gram_mining'; amount := 1;
  ELSIF r < 0.8275 THEN p_type := 'gram_mining'; amount := 2;
  ELSIF r < 0.8295 THEN p_type := 'gram_mining'; amount := 5;
  ELSIF r < 0.8300 THEN p_type := 'gram_mining'; amount := 10;
  ELSIF r < 0.9000 THEN p_type := 'deposit_bonus_pct'; amount := 10;
  ELSIF r < 0.9200 THEN p_type := 'deposit_bonus_pct'; amount := 25;
  ELSIF r < 0.9700 THEN p_type := 'gift_box'; amount := 1;
  ELSE p_type := 'extra_spin'; amount := 1;
  END IF;

  IF p_type = 'gram_mining' THEN
    gram_delta := round((amount * 0.033)::numeric, 10);
    UPDATE public.profiles
       SET mining_rate = COALESCE(mining_rate, 0) + gram_delta,
           mining_rate_usd = COALESCE(mining_rate_usd, 0) + (gram_delta * price)
     WHERE user_id = _user_id
    RETURNING mining_rate INTO new_rate;

    -- economy v2: 100 points per USD of mining capital won
    PERFORM public.grant_hashrate(_user_id, amount * price * 100, 'wheel', s_id, 180);

  ELSIF p_type = 'deposit_bonus_pct' THEN
    bonus_exp := now() + interval '48 hours';
    INSERT INTO public.deposit_bonuses (user_id, percent, expires_at)
    VALUES (_user_id, amount, bonus_exp);

  ELSIF p_type = 'gift_box' THEN
    INSERT INTO public.gift_boxes (user_id, source) VALUES (_user_id, 'other');

  ELSIF p_type = 'extra_spin' THEN
    INSERT INTO public.wheel_spins (user_id, source, source_ref_id)
    VALUES (_user_id, 'wheel', NULL);
  END IF;

  UPDATE public.wheel_spins
     SET status = 'used', used_at = now(), prize_type = p_type, prize_amount = amount
   WHERE id = s_id;

  SELECT count(*)::int INTO spins_left
  FROM public.wheel_spins
  WHERE user_id = _user_id AND status = 'available' AND expires_at > now();

  prize_type := p_type;
  prize_amount := amount;
  new_mining_rate := new_rate;
  bonus_expires_at := bonus_exp;
  RETURN NEXT;
END;
$function$;

-- Gift boxes also grant mining power.
CREATE OR REPLACE FUNCTION public.open_gift_box(_user_id uuid, _box_id uuid)
 RETURNS TABLE(prize_type text, prize_amount numeric, mining_rate_gram numeric, bonus_expires_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  new_rate_gram numeric;
  bonus_expires timestamptz;
  has_active_bonus boolean;
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

  IF has_active_bonus OR random() < 0.60 THEN
    p_type := 'gram_mining';
    tier := random();
    IF tier < 0.85 THEN low := 0.0000001; high := 0.000005;
    ELSIF tier < 0.98 THEN low := 0.000005; high := 0.00005;
    ELSE low := 0.00005; high := 0.0005;
    END IF;
    amount := round((low + random() * (high - low))::numeric, 8);

    gram_delta := round((amount * 0.033)::numeric, 10);

    UPDATE public.profiles
       SET mining_rate = COALESCE(mining_rate, 0) + gram_delta,
           mining_rate_usd = COALESCE(mining_rate_usd, 0) + (gram_delta * 2.5)
     WHERE user_id = _user_id
    RETURNING mining_rate INTO new_rate_gram;

    PERFORM public.grant_hashrate(_user_id, amount * 2.5 * 100, 'gift_box', _box_id, 180);
  ELSE
    p_type := 'deposit_bonus_pct';
    tier := random();
    IF tier < 0.85 THEN low := 1; high := 15;
    ELSIF tier < 0.97 THEN low := 15; high := 25;
    ELSE low := 25; high := 30;
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

-- Daily payout cron (idempotent per day).
SELECT cron.schedule(
  'daily-payout',
  '*/10 0-1 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--88f1a58d-13ac-47b7-9a09-3414d6926b10.lovable.app/api/public/hooks/daily-payout',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);