-- 1) Legacy 3.3% accrual must stop when economy v2 is on (otherwise users are paid twice).
CREATE OR REPLACE FUNCTION public.atomic_collect_income_usd(_user_id uuid, _ton_price numeric)
 RETURNS TABLE(gained numeric, new_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rate_usd numeric;
  last_ts timestamptz;
  seconds numeric;
  earned numeric;
  bal numeric;
  v2 boolean;
BEGIN
  IF _ton_price IS NULL OR _ton_price <= 0 THEN
    RAISE EXCEPTION 'invalid ton price';
  END IF;

  SELECT COALESCE((value->>'enabled')::boolean, false) INTO v2
  FROM public.app_settings WHERE key = 'economy_v2';

  SELECT mining_rate_usd, last_collect_at
    INTO rate_usd, last_ts
    FROM public.profiles
   WHERE user_id = _user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF COALESCE(v2, false) THEN
    -- Rewards come exclusively from the daily network pool.
    UPDATE public.profiles SET last_collect_at = now() WHERE user_id = _user_id
    RETURNING balance INTO bal;
    gained := 0;
    new_balance := bal;
    RETURN NEXT;
    RETURN;
  END IF;

  seconds := GREATEST(0, EXTRACT(EPOCH FROM (now() - last_ts)));
  earned := (COALESCE(rate_usd, 0) / 86400) * seconds / _ton_price;

  UPDATE public.profiles
     SET balance = balance + earned,
         last_collect_at = now()
   WHERE user_id = _user_id
  RETURNING balance INTO bal;

  gained := earned;
  new_balance := bal;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.atomic_collect_income(_user_id uuid)
 RETURNS TABLE(gained numeric, new_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rate numeric;
  last_ts timestamptz;
  seconds numeric;
  earned numeric;
  bal numeric;
  v2 boolean;
BEGIN
  SELECT COALESCE((value->>'enabled')::boolean, false) INTO v2
  FROM public.app_settings WHERE key = 'economy_v2';

  SELECT mining_rate, last_collect_at, balance
    INTO rate, last_ts, bal
    FROM public.profiles
   WHERE user_id = _user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF COALESCE(v2, false) THEN
    UPDATE public.profiles SET last_collect_at = now() WHERE user_id = _user_id
    RETURNING balance INTO bal;
    gained := 0;
    new_balance := bal;
    RETURN NEXT;
    RETURN;
  END IF;

  seconds := GREATEST(0, EXTRACT(EPOCH FROM (now() - last_ts)));
  earned  := (COALESCE(rate, 0) / 86400) * seconds;

  UPDATE public.profiles
     SET balance = balance + earned,
         last_collect_at = now()
   WHERE user_id = _user_id
  RETURNING balance INTO bal;

  gained := earned;
  new_balance := bal;
  RETURN NEXT;
END;
$function$;

-- 2) Daily payout: only hashrate that already existed at the end of the paid day
--    is eligible, so late deposits cannot claim a share of a past day's pool.
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
  v_cutoff timestamptz := (_day + 1)::timestamptz;
  v_processed integer := 0;
  v_remaining integer := 0;
  v_paid numeric;
  r record;
BEGIN
  SELECT * INTO row_pool FROM public.payout_pool_daily WHERE day = _day FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(sum(amount_usd), 0) INTO v_revenue
    FROM public.revenue_events
    WHERE occurred_at >= _day::timestamptz AND occurred_at < v_cutoff;

    SELECT COALESCE(sum(balance), 0) INTO v_debt_usd FROM public.profiles;
    v_debt_usd := v_debt_usd * v_price;
    v_treasury_usd := COALESCE(_treasury_ton, 0) * v_price;
    v_solvency := CASE WHEN v_debt_usd > 0 THEN v_treasury_usd / v_debt_usd ELSE 999 END;

    SELECT COALESCE((value->>'value')::numeric, 0.65) INTO v_ratio
    FROM public.app_settings WHERE key = 'payout_ratio';
    v_ratio := LEAST(GREATEST(COALESCE(v_ratio, 0.65), 0), 1);

    IF v_solvency < 1.0 THEN v_ratio := LEAST(v_ratio, 0.20);
    ELSIF v_solvency < 1.2 THEN v_ratio := LEAST(v_ratio, 0.40);
    END IF;

    v_pool := GREATEST(v_revenue, 0) * v_ratio;

    SELECT avg(pool_usd) INTO v_avg
    FROM public.payout_pool_daily
    WHERE day < _day AND day >= _day - 7 AND status = 'done';
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
    UPDATE public.payout_pool_daily SET status = 'done' WHERE day = _day;
    status := 'done'; processed := 0; remaining := 0;
    pool_usd := row_pool.pool_usd; total_hashrate := row_pool.total_hashrate; solvency := row_pool.solvency_ratio;
    RETURN NEXT; RETURN;
  END IF;

  SELECT COALESCE(sum(amount_usd), 0) INTO v_paid
  FROM public.payout_entries WHERE day = _day;

  FOR r IN
    SELECT g.user_id, sum(
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
      -- Hard cap: never distribute more than the pool for this day.
      v_usd := LEAST(v_usd, GREATEST(row_pool.pool_usd - v_paid, 0));
      v_gram := v_usd / v_price;
      IF v_gram > 0 THEN
        UPDATE public.profiles SET balance = balance + v_gram WHERE user_id = r.user_id;
      END IF;
      INSERT INTO public.payout_entries (day, user_id, hashrate, share, amount_usd, amount_gram)
      VALUES (_day, r.user_id, r.hp, v_share, v_usd, v_gram)
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
GRANT EXECUTE ON FUNCTION public.run_daily_payout(date, numeric, numeric, integer) TO service_role;