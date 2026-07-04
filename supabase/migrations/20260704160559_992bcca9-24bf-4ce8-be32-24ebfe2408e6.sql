
-- ============ GIFT BOXES ============
CREATE TABLE public.gift_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'referral',
  source_ref_id uuid,
  status text NOT NULL DEFAULT 'unopened',
  prize_type text,
  prize_amount numeric,
  opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_boxes_status_check CHECK (status IN ('unopened','opened')),
  CONSTRAINT gift_boxes_source_check CHECK (source IN ('referral','admin','other')),
  CONSTRAINT gift_boxes_prize_type_check CHECK (prize_type IS NULL OR prize_type IN ('gram_mining','deposit_bonus_pct'))
);
CREATE UNIQUE INDEX gift_boxes_user_source_ref_uniq
  ON public.gift_boxes(user_id, source, source_ref_id)
  WHERE source_ref_id IS NOT NULL;
CREATE INDEX gift_boxes_user_status_idx ON public.gift_boxes(user_id, status);

GRANT SELECT ON public.gift_boxes TO authenticated;
GRANT ALL ON public.gift_boxes TO service_role;

ALTER TABLE public.gift_boxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own gift boxes"
  ON public.gift_boxes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ============ DEPOSIT BONUSES ============
CREATE TABLE public.deposit_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  percent numeric NOT NULL,
  source_gift_box_id uuid REFERENCES public.gift_boxes(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deposit_bonuses_percent_check CHECK (percent > 0 AND percent <= 100)
);
CREATE INDEX deposit_bonuses_user_active_idx
  ON public.deposit_bonuses(user_id, expires_at)
  WHERE used_at IS NULL;

GRANT SELECT ON public.deposit_bonuses TO authenticated;
GRANT ALL ON public.deposit_bonuses TO service_role;

ALTER TABLE public.deposit_bonuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own deposit bonuses"
  ON public.deposit_bonuses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ============ OPEN GIFT BOX RPC ============
CREATE OR REPLACE FUNCTION public.open_gift_box(_user_id uuid, _box_id uuid)
RETURNS TABLE(prize_type text, prize_amount numeric, mining_rate_gram numeric, bonus_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b_status text;
  r numeric;
  tier numeric;
  amount numeric;
  p_type text;
  low numeric;
  high numeric;
  new_rate_gram numeric;
  bonus_expires timestamptz;
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

  -- 60% GRAM prize, 40% deposit bonus percent
  IF random() < 0.60 THEN
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

    -- Add to mining rate (GRAM/day). Also mirror in USD using a static reference price
    -- of 1 (since we cannot fetch TON price in SQL) — the server will normalize on
    -- collectIncome via mining_rate_usd not being touched. We only bump the GRAM leg
    -- and add a small USD equivalent using 2.5 USDT/TON as a stable estimate.
    UPDATE public.profiles
       SET mining_rate = COALESCE(mining_rate, 0) + amount,
           mining_rate_usd = COALESCE(mining_rate_usd, 0) + (amount * 2.5)
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

REVOKE EXECUTE ON FUNCTION public.open_gift_box(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_gift_box(uuid, uuid) TO service_role;

-- ============ AWARD BOX ON FIRST CONFIRMED DEPOSIT ============
CREATE OR REPLACE FUNCTION public.award_gift_box_on_first_deposit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_row public.referrals%ROWTYPE;
  prior_confirmed integer;
BEGIN
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Only first confirmed deposit of this user
  SELECT count(*) INTO prior_confirmed
  FROM public.deposits
  WHERE user_id = NEW.user_id
    AND status = 'confirmed'
    AND id <> NEW.id;
  IF prior_confirmed > 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO ref_row
  FROM public.referrals
  WHERE referred_id = NEW.user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.gift_boxes (user_id, source, source_ref_id)
  VALUES (ref_row.referrer_id, 'referral', ref_row.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_gift_box_on_first_deposit ON public.deposits;
CREATE TRIGGER trg_award_gift_box_on_first_deposit
AFTER INSERT OR UPDATE OF status ON public.deposits
FOR EACH ROW EXECUTE FUNCTION public.award_gift_box_on_first_deposit();

-- ============ BACKFILL ============
INSERT INTO public.gift_boxes (user_id, source, source_ref_id)
SELECT r.referrer_id, 'referral', r.id
FROM public.referrals r
WHERE EXISTS (
  SELECT 1 FROM public.deposits d
  WHERE d.user_id = r.referred_id AND d.status = 'confirmed'
)
ON CONFLICT DO NOTHING;

-- ============ CONSUME ACTIVE BONUS RPC ============
-- Returns the percent applied (0 if none). Marks the newest active bonus as used.
CREATE OR REPLACE FUNCTION public.consume_active_deposit_bonus(_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b_id uuid;
  b_pct numeric;
BEGIN
  SELECT id, percent INTO b_id, b_pct
  FROM public.deposit_bonuses
  WHERE user_id = _user_id
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE public.deposit_bonuses
     SET used_at = now()
   WHERE id = b_id;

  RETURN b_pct;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_active_deposit_bonus(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_active_deposit_bonus(uuid) TO service_role;
