CREATE TABLE public.wheel_spins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'deposit',
  source_ref_id uuid,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','used','expired')),
  prize_type text CHECK (prize_type IS NULL OR prize_type IN ('gram_mining','deposit_bonus_pct','gift_box','extra_spin')),
  prize_amount numeric,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wheel_spins_user_status ON public.wheel_spins (user_id, status);

GRANT SELECT ON public.wheel_spins TO authenticated;
GRANT ALL ON public.wheel_spins TO service_role;

ALTER TABLE public.wheel_spins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own wheel spins select" ON public.wheel_spins
FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Grant spins for a confirmed deposit: 1 per full $10 of the same deposit.
CREATE OR REPLACE FUNCTION public.grant_wheel_spins(_user_id uuid, _deposit_id uuid, _usd_value numeric)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
  i integer;
BEGIN
  IF _usd_value IS NULL OR _usd_value < 10 THEN
    RETURN 0;
  END IF;
  IF _deposit_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.wheel_spins WHERE source_ref_id = _deposit_id
  ) THEN
    RETURN 0;
  END IF;

  n := LEAST(floor(_usd_value / 10)::int, 100);
  FOR i IN 1..n LOOP
    INSERT INTO public.wheel_spins (user_id, source, source_ref_id)
    VALUES (_user_id, 'deposit', _deposit_id);
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_wheel_spins(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_wheel_spins(uuid, uuid, numeric) TO service_role;

-- Expire stale spins (older than 7 days) for a user.
CREATE OR REPLACE FUNCTION public.expire_stale_wheel_spins(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.wheel_spins
     SET status = 'expired'
   WHERE user_id = _user_id
     AND status = 'available'
     AND expires_at <= now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_wheel_spins(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_wheel_spins(uuid) TO service_role;

-- Spin the wheel. Server-side RNG; ~4% expected value of a $10 ticket.
CREATE OR REPLACE FUNCTION public.spin_wheel(_user_id uuid, _gram_price numeric DEFAULT 1)
RETURNS TABLE(
  prize_type text,
  prize_amount numeric,
  spins_left integer,
  new_mining_rate numeric,
  bonus_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Weighted prize table (cumulative)
  IF r < 0.4005 THEN
    p_type := 'gram_mining'; amount := 0.1;
  ELSIF r < 0.6205 THEN
    p_type := 'gram_mining'; amount := 0.2;
  ELSIF r < 0.7405 THEN
    p_type := 'gram_mining'; amount := 0.3;
  ELSIF r < 0.8005 THEN
    p_type := 'gram_mining'; amount := 0.5;
  ELSIF r < 0.8205 THEN
    p_type := 'gram_mining'; amount := 1;
  ELSIF r < 0.8275 THEN
    p_type := 'gram_mining'; amount := 2;
  ELSIF r < 0.8295 THEN
    p_type := 'gram_mining'; amount := 5;
  ELSIF r < 0.8300 THEN
    p_type := 'gram_mining'; amount := 10;
  ELSIF r < 0.9000 THEN
    p_type := 'deposit_bonus_pct'; amount := 10;
  ELSIF r < 0.9200 THEN
    p_type := 'deposit_bonus_pct'; amount := 25;
  ELSIF r < 0.9700 THEN
    p_type := 'gift_box'; amount := 1;
  ELSE
    p_type := 'extra_spin'; amount := 1;
  END IF;

  IF p_type = 'gram_mining' THEN
    -- Prize is mining capital: it produces 3.3% daily like a deposit.
    gram_delta := round((amount * 0.033)::numeric, 10);
    UPDATE public.profiles
       SET mining_rate = COALESCE(mining_rate, 0) + gram_delta,
           mining_rate_usd = COALESCE(mining_rate_usd, 0) + (gram_delta * price)
     WHERE user_id = _user_id
    RETURNING mining_rate INTO new_rate;

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
$$;

REVOKE ALL ON FUNCTION public.spin_wheel(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spin_wheel(uuid, numeric) TO service_role;