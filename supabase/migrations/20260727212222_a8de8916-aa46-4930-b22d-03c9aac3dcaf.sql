CREATE TABLE IF NOT EXISTS public.deposit_promotion_uses (
  promotion_id uuid NOT NULL REFERENCES public.deposit_promotions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  used_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (promotion_id, user_id)
);

GRANT SELECT ON public.deposit_promotion_uses TO authenticated;
GRANT ALL ON public.deposit_promotion_uses TO service_role;

ALTER TABLE public.deposit_promotion_uses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own promotion uses select" ON public.deposit_promotion_uses;
CREATE POLICY "own promotion uses select"
ON public.deposit_promotion_uses FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- Atomically claim the promotion for a user. Returns the percent to apply,
-- or 0 when the user already used this promotion.
CREATE OR REPLACE FUNCTION public.claim_deposit_promotion(_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  promo_id uuid;
  pct numeric;
BEGIN
  SELECT p.id, p.percent INTO promo_id, pct
  FROM public.deposit_promotions p
  WHERE p.starts_at <= now() AND p.ends_at > now()
  ORDER BY p.percent DESC, p.ends_at DESC
  LIMIT 1;

  IF promo_id IS NULL THEN
    RETURN 0;
  END IF;

  BEGIN
    INSERT INTO public.deposit_promotion_uses (promotion_id, user_id)
    VALUES (promo_id, _user_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN 0;
  END;

  RETURN pct;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_deposit_promotion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_deposit_promotion(uuid) TO service_role;