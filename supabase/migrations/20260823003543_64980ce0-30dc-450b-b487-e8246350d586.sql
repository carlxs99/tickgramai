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
  v_hash numeric;
  v_debt_usd numeric;
  v_treasury_usd numeric;
  v_solvency numeric;
  v_price numeric := GREATEST(COALESCE(_gram_price, 0), 0.000001);
  v_cutoff timestamptz := (_day + 1)::timestamptz;
  v_processed integer := 0;
  v_remaining integer := 0;
  v_paid numeric;
  v_share numeric;
  v_amount numeric;
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
    v_treasury_usd := GREATEST(COALESCE(_treasury_ton, 0), 0) * v_price;
    v_solvency := CASE WHEN v_debt_usd > 0 THEN v_treasury_usd / v_debt_usd ELSE 999 END;

    SELECT COALESCE((s.value->>'value')::numeric, 0.65) INTO v_ratio
    FROM public.app_settings s WHERE s.key = 'payout_ratio';
    v_ratio := LEAST(GREATEST(COALESCE(v_ratio, 0.65), 0), 1);

    -- Pool = full wallet balance minus the house cut (1 - payout_ratio).
    v_pool := GREATEST(v_treasury_usd, 0) * v_ratio;

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
      (_day, v_revenue, v_ratio, GREATEST(v_pool, 0), v_treasury_usd - GREATEST(v_pool, 0), v_hash,
       COALESCE(_treasury_ton, 0), v_solvency, v_price, 'running')
    RETURNING * INTO row_pool;

    INSERT INTO public.treasury_ledger (direction, amount_usd, reason, ref)
    VALUES ('in', GREATEST(v_treasury_usd - GREATEST(v_pool, 0), 0), 'daily_retained', _day::text);
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
    LIMIT _batch
  LOOP
    v_share := CASE WHEN row_pool.total_hashrate > 0 THEN LEAST(r.hp / row_pool.total_hashrate, 1) ELSE 0 END;
    v_amount := row_pool.pool_usd * v_share;
    IF v_amount > 0 THEN
      INSERT INTO public.payout_entries (day, user_id, hashrate, share, amount_usd, amount_gram)
      VALUES (_day, r.uid, r.hp, v_share, v_amount, v_amount / v_price)
      ON CONFLICT (day, user_id) DO NOTHING;
      v_paid := v_paid + v_amount;
    END IF;
    v_processed := v_processed + 1;
  END LOOP;

  SELECT count(*) INTO v_remaining
  FROM (
    SELECT g.user_id
    FROM public.hashrate_grants g
    JOIN public.profiles p ON p.user_id = g.user_id
    WHERE g.active AND g.expires_at > now() AND p.banned = false
      AND g.starts_at < v_cutoff
      AND NOT EXISTS (SELECT 1 FROM public.payout_entries e WHERE e.day = _day AND e.user_id = g.user_id)
    GROUP BY g.user_id
    HAVING sum(g.points) > 0
  ) q;

  UPDATE public.payout_pool_daily pp
  SET paid_usd = v_paid,
      users_paid = (SELECT count(*) FROM public.payout_entries e WHERE e.day = _day),
      status = CASE WHEN v_remaining = 0 THEN 'done' ELSE 'running' END,
      updated_at = now()
  WHERE pp.day = _day;

  status := CASE WHEN v_remaining = 0 THEN 'done' ELSE 'running' END;
  processed := v_processed;
  remaining := v_remaining;
  pool_usd := row_pool.pool_usd;
  total_hashrate := row_pool.total_hashrate;
  solvency := row_pool.solvency_ratio;
  RETURN NEXT;
END;
$function$;