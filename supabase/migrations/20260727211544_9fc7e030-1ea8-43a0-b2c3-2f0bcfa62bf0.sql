CREATE TABLE public.deposit_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  percent numeric NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.deposit_promotions TO authenticated;
GRANT ALL ON public.deposit_promotions TO service_role;

ALTER TABLE public.deposit_promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "promotions readable by authenticated"
ON public.deposit_promotions FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_deposit_promotions_updated_at
BEFORE UPDATE ON public.deposit_promotions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_deposit_promotions_window ON public.deposit_promotions (ends_at DESC);

CREATE OR REPLACE FUNCTION public.get_active_deposit_promotion()
RETURNS TABLE(id uuid, percent numeric, starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.percent, p.starts_at, p.ends_at
  FROM public.deposit_promotions p
  WHERE p.starts_at <= now() AND p.ends_at > now()
  ORDER BY p.percent DESC, p.ends_at DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_active_deposit_promotion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_deposit_promotion() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.start_weekly_deposit_promotion(_duration_hours integer DEFAULT 48)
RETURNS TABLE(id uuid, percent numeric, starts_at timestamptz, ends_at timestamptz, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing public.deposit_promotions%ROWTYPE;
  pct numeric;
  ins public.deposit_promotions%ROWTYPE;
BEGIN
  SELECT * INTO existing
  FROM public.deposit_promotions p
  WHERE p.starts_at <= now() AND p.ends_at > now()
  ORDER BY p.ends_at DESC
  LIMIT 1;

  IF FOUND THEN
    id := existing.id; percent := existing.percent;
    starts_at := existing.starts_at; ends_at := existing.ends_at;
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Weighted random: 15% .. 200%, skewed towards the lower end.
  pct := round((15 + power(random(), 2.2) * 185)::numeric, 0);

  INSERT INTO public.deposit_promotions (percent, starts_at, ends_at)
  VALUES (pct, now(), now() + make_interval(hours => GREATEST(1, LEAST(_duration_hours, 168))))
  RETURNING * INTO ins;

  id := ins.id; percent := ins.percent;
  starts_at := ins.starts_at; ends_at := ins.ends_at;
  created := true;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.start_weekly_deposit_promotion(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_weekly_deposit_promotion(integer) TO service_role;

INSERT INTO public.deposit_promotions (percent, starts_at, ends_at)
VALUES (round((15 + power(random(), 2.2) * 185)::numeric, 0), now(), now() + interval '48 hours');