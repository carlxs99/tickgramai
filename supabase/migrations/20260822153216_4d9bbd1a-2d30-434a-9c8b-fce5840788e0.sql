-- ============ ECONOMY V2 ============

CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings admin read" ON public.app_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER t_app_settings_upd BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_settings (key, value) VALUES
  ('economy_v2', '{"enabled": false}'::jsonb),
  ('payout_ratio', '{"value": 0.65}'::jsonb);

-- Revenue -----------------------------------------------------------------
CREATE TABLE public.revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  amount_usd numeric(20,6) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  note text,
  ref text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX revenue_events_source_ref_uidx ON public.revenue_events (source, ref) WHERE ref IS NOT NULL;
CREATE INDEX revenue_events_occurred_idx ON public.revenue_events (occurred_at);
GRANT ALL ON public.revenue_events TO service_role;
GRANT SELECT ON public.revenue_events TO authenticated;
ALTER TABLE public.revenue_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revenue admin read" ON public.revenue_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Hashrate ----------------------------------------------------------------
CREATE TABLE public.hashrate_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  points numeric(20,6) NOT NULL,
  source text NOT NULL DEFAULT 'deposit',
  source_ref_id uuid,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hashrate_grants_user_idx ON public.hashrate_grants (user_id) WHERE active;
CREATE INDEX hashrate_grants_expiry_idx ON public.hashrate_grants (expires_at) WHERE active;
GRANT ALL ON public.hashrate_grants TO service_role;
GRANT SELECT ON public.hashrate_grants TO authenticated;
ALTER TABLE public.hashrate_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hashrate own read" ON public.hashrate_grants FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- Daily pool --------------------------------------------------------------
CREATE TABLE public.payout_pool_daily (
  day date PRIMARY KEY,
  revenue_usd numeric(20,6) NOT NULL DEFAULT 0,
  payout_ratio numeric(6,4) NOT NULL DEFAULT 0.65,
  pool_usd numeric(20,6) NOT NULL DEFAULT 0,
  reserve_delta numeric(20,6) NOT NULL DEFAULT 0,
  total_hashrate numeric(24,6) NOT NULL DEFAULT 0,
  treasury_ton numeric(20,9) NOT NULL DEFAULT 0,
  solvency_ratio numeric(12,4),
  gram_price numeric(20,8) NOT NULL DEFAULT 0,
  paid_usd numeric(20,6) NOT NULL DEFAULT 0,
  users_paid integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.payout_pool_daily TO service_role;
GRANT SELECT ON public.payout_pool_daily TO authenticated;
ALTER TABLE public.payout_pool_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pool readable by authenticated" ON public.payout_pool_daily FOR SELECT TO authenticated USING (true);
CREATE TRIGGER t_payout_pool_upd BEFORE UPDATE ON public.payout_pool_daily FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.payout_entries (
  day date NOT NULL,
  user_id uuid NOT NULL,
  hashrate numeric(24,6) NOT NULL,
  share numeric(12,10) NOT NULL,
  amount_usd numeric(20,8) NOT NULL,
  amount_gram numeric(20,9) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, user_id)
);
CREATE INDEX payout_entries_user_idx ON public.payout_entries (user_id, day DESC);
GRANT ALL ON public.payout_entries TO service_role;
GRANT SELECT ON public.payout_entries TO authenticated;
ALTER TABLE public.payout_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout entries own read" ON public.payout_entries FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- Treasury ----------------------------------------------------------------
CREATE TABLE public.treasury_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL,
  amount_usd numeric(20,6) NOT NULL,
  reason text NOT NULL,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.treasury_ledger TO service_role;
GRANT SELECT ON public.treasury_ledger TO authenticated;
ALTER TABLE public.treasury_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "treasury admin read" ON public.treasury_ledger FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Functions ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_active_hashrate(_user_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(
    g.points * GREATEST(0, LEAST(1,
      EXTRACT(EPOCH FROM (g.expires_at - now()))
      / NULLIF(EXTRACT(EPOCH FROM (g.expires_at - g.starts_at)), 0)))
  ), 0)::numeric
  FROM public.hashrate_grants g
  WHERE g.user_id = _user_id AND g.active AND g.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.network_active_hashrate()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(
    g.points * GREATEST(0, LEAST(1,
      EXTRACT(EPOCH FROM (g.expires_at - now()))
      / NULLIF(EXTRACT(EPOCH FROM (g.expires_at - g.starts_at)), 0)))
  ), 0)::numeric
  FROM public.hashrate_grants g
  JOIN public.profiles p ON p.user_id = g.user_id
  WHERE g.active AND g.expires_at > now() AND p.banned = false;
$$;

CREATE OR REPLACE FUNCTION public.grant_hashrate(_user_id uuid, _points numeric, _source text DEFAULT 'deposit', _source_ref_id uuid DEFAULT NULL, _days integer DEFAULT 180)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF _points IS NULL OR _points <= 0 THEN RETURN NULL; END IF;
  IF _source_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.hashrate_grants WHERE source = _source AND source_ref_id = _source_ref_id
  ) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.hashrate_grants (user_id, points, source, source_ref_id, expires_at)
  VALUES (_user_id, _points, _source, _source_ref_id, now() + make_interval(days => GREATEST(1, _days)))
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;

CREATE OR REPLACE FUNCTION public.add_revenue_event(_source text, _amount_usd numeric, _note text DEFAULT NULL, _ref text DEFAULT NULL, _created_by uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF _amount_usd IS NULL OR _amount_usd = 0 THEN RETURN NULL; END IF;
  INSERT INTO public.revenue_events (source, amount_usd, note, ref, created_by)
  VALUES (_source, _amount_usd, _note, _ref, _created_by)
  ON CONFLICT DO NOTHING
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;

-- Daily payout: idempotent per day, resumable in batches.
CREATE OR REPLACE FUNCTION public.run_daily_payout(_day date, _gram_price numeric, _treasury_ton numeric DEFAULT 0, _batch integer DEFAULT 300)
RETURNS TABLE(status text, processed integer, remaining integer, pool_usd numeric, total_hashrate numeric, solvency numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_pool public.payout_pool_daily%ROWTYPE;
  v_revenue numeric;
  v_ratio numeric;
  v_pool numeric;
  v_avg numeric;
  v_hash numeric;
  v_debt_usd numeric;
  v_treasury_usd numeric;
  v_solvency numeric;
  v_price numeric := GREATEST(COALESCE(_gram_price, 0), 0.000001);
  v_processed integer := 0;
  v_remaining integer := 0;
  r record;
BEGIN
  SELECT * INTO row_pool FROM public.payout_pool_daily WHERE day = _day FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(sum(amount_usd), 0) INTO v_revenue
    FROM public.revenue_events
    WHERE occurred_at >= _day::timestamptz AND occurred_at < (_day + 1)::timestamptz;

    SELECT COALESCE(sum(balance), 0) INTO v_debt_usd FROM public.profiles;
    v_debt_usd := v_debt_usd * v_price;
    v_treasury_usd := COALESCE(_treasury_ton, 0) * v_price;
    v_solvency := CASE WHEN v_debt_usd > 0 THEN v_treasury_usd / v_debt_usd ELSE 999 END;

    SELECT COALESCE((value->>'value')::numeric, 0.65) INTO v_ratio
    FROM public.app_settings WHERE key = 'payout_ratio';
    v_ratio := COALESCE(v_ratio, 0.65);

    IF v_solvency < 1.0 THEN v_ratio := LEAST(v_ratio, 0.20);
    ELSIF v_solvency < 1.2 THEN v_ratio := LEAST(v_ratio, 0.40);
    END IF;

    v_pool := v_revenue * v_ratio;

    -- Smoothing against the 7-day average pool.
    SELECT avg(pool_usd) INTO v_avg
    FROM public.payout_pool_daily
    WHERE day < _day AND day >= _day - 7 AND status = 'done';
    IF v_avg IS NOT NULL AND v_avg > 0 THEN
      v_pool := LEAST(GREATEST(v_pool, v_avg * 0.70), v_avg * 1.30);
    END IF;

    v_hash := public.network_active_hashrate();

    INSERT INTO public.payout_pool_daily
      (day, revenue_usd, payout_ratio, pool_usd, reserve_delta, total_hashrate, treasury_ton, solvency_ratio, gram_price, status)
    VALUES
      (_day, v_revenue, v_ratio, GREATEST(v_pool, 0), (v_revenue * v_ratio) - GREATEST(v_pool, 0), v_hash,
       COALESCE(_treasury_ton, 0), v_solvency, v_price, 'running')
    RETURNING * INTO row_pool;

    INSERT INTO public.treasury_ledger (direction, amount_usd, reason, ref)
    VALUES ('in', v_revenue - GREATEST(v_pool, 0), 'daily_retained', _day::text);
  END IF;

  IF row_pool.status = 'done' THEN
    status := 'done'; processed := 0; remaining := 0;
    pool_usd := row_pool.pool_usd; total_hashrate := row_pool.total_hashrate; solvency := row_pool.solvency_ratio;
    RETURN NEXT; RETURN;
  END IF;

  IF row_pool.total_hashrate <= 0 OR row_pool.pool_usd <= 0 THEN
    UPDATE public.payout_pool_daily SET status = 'done' WHERE day = _day;
    status := 'done'; processed := 0; remaining := 0;
    pool_usd := row_pool.pool_usd; total_hashrate := row_pool.total_hashrate; solvency := row_pool.solvency_ratio;
    RETURN NEXT; RETURN;
  END IF;

  FOR r IN
    SELECT g.user_id, sum(
      g.points * GREATEST(0, LEAST(1,
        EXTRACT(EPOCH FROM (g.expires_at - now()))
        / NULLIF(EXTRACT(EPOCH FROM (g.expires_at - g.starts_at)), 0)))
    ) AS hp
    FROM public.hashrate_grants g
    JOIN public.profiles p ON p.user_id = g.user_id
    WHERE g.active AND g.expires_at > now() AND p.banned = false
      AND NOT EXISTS (SELECT 1 FROM public.payout_entries e WHERE e.day = _day AND e.user_id = g.user_id)
    GROUP BY g.user_id
    HAVING sum(g.points) > 0
    ORDER BY g.user_id
    LIMIT GREATEST(1, _batch)
  LOOP
    DECLARE
      v_share numeric := r.hp / row_pool.total_hashrate;
      v_usd numeric;
      v_gram numeric;
    BEGIN
      v_usd := row_pool.pool_usd * v_share;
      v_gram := v_usd / v_price;
      IF v_gram > 0 THEN
        UPDATE public.profiles SET balance = balance + v_gram WHERE user_id = r.user_id;
      END IF;
      INSERT INTO public.payout_entries (day, user_id, hashrate, share, amount_usd, amount_gram)
      VALUES (_day, r.user_id, r.hp, LEAST(v_share, 1), v_usd, v_gram)
      ON CONFLICT DO NOTHING;
      v_processed := v_processed + 1;
    END;
  END LOOP;

  SELECT count(*) INTO v_remaining FROM (
    SELECT g.user_id
    FROM public.hashrate_grants g
    JOIN public.profiles p ON p.user_id = g.user_id
    WHERE g.active AND g.expires_at > now() AND p.banned = false
      AND NOT EXISTS (SELECT 1 FROM public.payout_entries e WHERE e.day = _day AND e.user_id = g.user_id)
    GROUP BY g.user_id
  ) q;

  UPDATE public.payout_pool_daily
     SET paid_usd = (SELECT COALESCE(sum(amount_usd), 0) FROM public.payout_entries WHERE day = _day),
         users_paid = (SELECT count(*) FROM public.payout_entries WHERE day = _day),
         status = CASE WHEN v_remaining = 0 THEN 'done' ELSE 'running' END
   WHERE day = _day;

  status := CASE WHEN v_remaining = 0 THEN 'done' ELSE 'running' END;
  processed := v_processed;
  remaining := v_remaining;
  pool_usd := row_pool.pool_usd;
  total_hashrate := row_pool.total_hashrate;
  solvency := row_pool.solvency_ratio;
  RETURN NEXT;
END; $$;

REVOKE ALL ON FUNCTION public.run_daily_payout(date, numeric, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_hashrate(uuid, numeric, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_revenue_event(text, numeric, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_active_hashrate() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_active_hashrate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_payout(date, numeric, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_hashrate(uuid, numeric, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_revenue_event(text, numeric, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.network_active_hashrate() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_active_hashrate(uuid) TO authenticated, service_role;