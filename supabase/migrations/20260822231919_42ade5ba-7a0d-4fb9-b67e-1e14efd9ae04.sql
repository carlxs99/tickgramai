ALTER TABLE public.payout_entries ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
UPDATE public.payout_entries SET claimed_at = COALESCE(claimed_at, created_at) WHERE claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS payout_entries_unclaimed_idx ON public.payout_entries (user_id) WHERE claimed_at IS NULL;

CREATE OR REPLACE FUNCTION public.run_daily_payout(_day date, _gram_price numeric, _treasury_ton numeric DEFAULT 0, _batch integer DEFAULT 300)
 RETURNS TABLE(status text, processed integer, remaining integer, pool_usd numeric, total_hashrate numeric, solvency numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  row_pool public.payout_pool_daily%ROWTYPE;
  v_revenue numeric;
  v_deferred numeric;
  v_ratio numeric;
  v_pool numeric;
  v_avg numeric;
  v_hash numeric;
  v_debt_usd numeric;
  v_treasury_usd numeric;
  v_solvency numeric;
  v_price numeric := GREATEST(COALESCE(_gram_price, 0), 0.000001);
  v_cutoff timestamptz := (_day + 1)::timestamptz;
  v_processed integer := 0;
  v_remaining integer := 0;
  v_paid numeric;
  r record;
BEGIN
  SELECT pp.* INTO row_pool FROM public.payout_pool_daily pp WHERE pp.day = _day FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(sum(re.amount_usd), 0) INTO v_revenue
    FROM public.revenue_events re
    WHERE re.occurred_at >= _day::timestamptz AND re.occurred_at < v_cutoff;

    SELECT COALESCE(sum(dr.daily_usd), 0) INTO v_deferred
    FROM public.deferred_revenue dr
    WHERE dr.starts_on <= _day AND dr.ends_on >= _day;

    v_revenue := v_revenue + v_deferred;

    SELECT COALESCE(sum(pf.balance), 0) INTO v_debt_usd FROM public.profiles pf;
    v_debt_usd := v_debt_usd * v_price;
    v_treasury_usd := COALESCE(_treasury_ton, 0) * v_price;
    v_solvency := CASE WHEN v_debt_usd > 0 THEN v_treasury_usd / v_debt_usd ELSE 999 END;

    SELECT COALESCE((s.value->>'value')::numeric, 0.65) INTO v_ratio
    FROM public.app_settings s WHERE s.key = 'payout_ratio';
    v_ratio := LEAST(GREATEST(COALESCE(v_ratio, 0.65), 0), 1);

    IF v_solvency < 1.0 THEN v_ratio := LEAST(v_ratio, 0.20);
    ELSIF v_solvency < 1.2 THEN v_ratio := LEAST(v_ratio, 0.40);
    END IF;

    v_pool := GREATEST(v_revenue, 0) * v_ratio;

    SELECT avg(pp.pool_usd) INTO v_avg
    FROM public.payout_pool_daily pp
    WHERE pp.day < _day AND pp.day >= _day - 7 AND pp.status = 'done';
    IF v_avg IS NOT NULL AND v_avg > 0 THEN
      v_pool := LEAST(GREATEST(v_pool, v_avg * 0.70), v_avg * 1.30);
    END IF;

    SELECT COALESCE(sum(
      g.points * GREATEST(0, LEAST(1,
        EXTRACT(EPOCH FROM (g.expires_at - now()))
        / NULLIF(EXTRACT(EPOCH FROM (g.expires_at - g.starts_at)), 0)))
    ), 0) INTO v_hash
    FROM public.hashrate_grants g
    JOIN public.profiles p ON p.user_id = g.user_id
    WHERE g.active AND g.expires_at > now() AND p.banned = false
      AND g.starts_at < v_cutoff;

    INSERT INTO public.payout_pool_daily
      (day, revenue_usd, payout_ratio, pool_usd, reserve_delta, total_hashrate, treasury_ton, solvency_ratio, gram_price, status)
    VALUES
      (_day, v_revenue, v_ratio, GREATEST(v_pool, 0), v_revenue - GREATEST(v_pool, 0), v_hash,
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
    UPDATE public.payout_pool_daily pp SET status = 'done' WHERE pp.day = _day;
    status := 'done'; processed := 0; remaining := 0;
    pool_usd := row_pool.pool_usd; total_hashrate := row_pool.total_hashrate; solvency := row_pool.solvency_ratio;
    RETURN NEXT; RETURN;
  END IF;

  SELECT COALESCE(sum(e.amount_usd), 0) INTO v_paid
  FROM public.payout_entries e WHERE e.day = _day;

  FOR r IN
    SELECT g.user_id AS uid, sum(
      g.points * GREATEST(0, LEAST(1,
        EXTRACT(EPOCH FROM (g.expires_at - now()))
        / NULLIF(EXTRACT(EPOCH FROM (g.expires_at - g.starts_at)), 0)))
    ) AS hp
    FROM public.hashrate_grants g
    JOIN public.profiles p ON p.user_id = g.user_id
    WHERE g.active AND g.expires_at > now() AND p.banned = false
      AND g.starts_at < v_cutoff
      AND NOT EXISTS (SELECT 1 FROM public.payout_entries e WHERE e.day = _day AND e.user_id = g.user_id)
    GROUP BY g.user_id
    HAVING sum(g.points) > 0
    ORDER BY g.user_id
    LIMIT GREATEST(1, _batch)
  LOOP
    DECLARE
      v_share numeric := LEAST(r.hp / row_pool.total_hashrate, 1);
      v_usd numeric;
      v_gram numeric;
    BEGIN
      v_usd := row_pool.pool_usd * v_share;
      v_usd := LEAST(v_usd, GREATEST(row_pool.pool_usd - v_paid, 0));
      v_gram := v_usd / v_price;
      -- Rewards are NOT credited automatically: the user must claim them.
      INSERT INTO public.payout_entries (day, user_id, hashrate, share, amount_usd, amount_gram, claimed_at)
      VALUES (_day, r.uid, r.hp, v_share, v_usd, v_gram, NULL)
      ON CONFLICT DO NOTHING;
      v_paid := v_paid + v_usd;
      v_processed := v_processed + 1;
    END;
  END LOOP;

  SELECT count(*) INTO v_remaining FROM (
    SELECT g.user_id
    FROM public.hashrate_grants g
    JOIN public.profiles p ON p.user_id = g.user_id
    WHERE g.active AND g.expires_at > now() AND p.banned = false
      AND g.starts_at < v_cutoff
      AND NOT EXISTS (SELECT 1 FROM public.payout_entries e WHERE e.day = _day AND e.user_id = g.user_id)
    GROUP BY g.user_id
  ) q;

  UPDATE public.payout_pool_daily pp
     SET paid_usd = (SELECT COALESCE(sum(e.amount_usd), 0) FROM public.payout_entries e WHERE e.day = _day),
         users_paid = (SELECT count(*) FROM public.payout_entries e WHERE e.day = _day),
         status = CASE WHEN v_remaining = 0 THEN 'done' ELSE 'running' END
   WHERE pp.day = _day;

  status := CASE WHEN v_remaining = 0 THEN 'done' ELSE 'running' END;
  processed := v_processed;
  remaining := v_remaining;
  pool_usd := row_pool.pool_usd;
  total_hashrate := row_pool.total_hashrate;
  solvency := row_pool.solvency_ratio;
  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION public.claim_payouts(_user_id uuid)
RETURNS TABLE(gained numeric, days integer, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gained numeric := 0;
  v_days integer := 0;
  v_balance numeric;
BEGIN
  PERFORM 1 FROM public.profiles WHERE user_id = _user_id FOR UPDATE;

  WITH upd AS (
    UPDATE public.payout_entries e
       SET claimed_at = now()
     WHERE e.user_id = _user_id AND e.claimed_at IS NULL
     RETURNING e.amount_gram
  )
  SELECT COALESCE(sum(amount_gram), 0), count(*) INTO v_gained, v_days FROM upd;

  IF v_gained > 0 THEN
    UPDATE public.profiles SET balance = balance + v_gained, updated_at = now()
     WHERE user_id = _user_id
     RETURNING balance INTO v_balance;
  ELSE
    SELECT balance INTO v_balance FROM public.profiles WHERE user_id = _user_id;
  END IF;

  gained := COALESCE(v_gained, 0);
  days := COALESCE(v_days, 0);
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END; $$;

REVOKE ALL ON FUNCTION public.claim_payouts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payouts(uuid) TO service_role;