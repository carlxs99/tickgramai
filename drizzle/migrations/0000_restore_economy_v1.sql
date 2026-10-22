-- 1) Pay out any unclaimed v2 daily payouts to users' balances.
UPDATE public.profiles p
   SET balance = p.balance + x.total
  FROM (
    SELECT user_id, SUM(amount_gram) AS total
      FROM public.payout_entries
     WHERE claimed_at IS NULL
     GROUP BY user_id
  ) x
 WHERE p.user_id = x.user_id AND x.total > 0;
UPDATE public.payout_entries SET claimed_at = now() WHERE claimed_at IS NULL;

-- 2) Restore the v1 fixed 3.3%/day mining rate from all mining power users held
--    (100 points = $1 of mining capital -> $0.033/day). Mining restarts from now.
UPDATE public.profiles p
   SET mining_rate_usd = GREATEST(COALESCE(p.mining_rate_usd, 0), g.rate_usd),
       mining_rate     = GREATEST(COALESCE(p.mining_rate_usd, 0), g.rate_usd) / 1.6,
       last_collect_at = now()
  FROM (
    SELECT user_id, SUM(points) * 0.033 / 100.0 AS rate_usd
      FROM public.hashrate_grants
     GROUP BY user_id
  ) g
 WHERE p.user_id = g.user_id;
UPDATE public.hashrate_grants SET active = false WHERE active;

-- 3) Turn off economy v2 and stop the daily payout job.
UPDATE public.app_settings SET value = '{"enabled": false}'::jsonb WHERE key = 'economy_v2';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-payout') THEN
    PERFORM cron.unschedule('daily-payout');
  END IF;
END $$;

-- 4) Any late "hashrate" grant (from a not-yet-updated client) becomes v1 mining rate.
CREATE OR REPLACE FUNCTION public.grant_hashrate(_user_id uuid, _points numeric, _source text DEFAULT 'deposit'::text, _source_ref_id uuid DEFAULT NULL::uuid, _days integer DEFAULT 180)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  add_usd numeric;
BEGIN
  IF _user_id IS NULL OR COALESCE(_points, 0) <= 0 THEN RETURN NULL; END IF;
  add_usd := _points * 0.033 / 100.0;
  UPDATE public.profiles
     SET mining_rate_usd = COALESCE(mining_rate_usd, 0) + add_usd,
         mining_rate     = COALESCE(mining_rate, 0) + add_usd / 1.6
   WHERE user_id = _user_id;
  RETURN NULL;
END;
$function$;
COMMENT ON FUNCTION public.grant_hashrate(uuid, numeric, text, uuid, integer) IS 'DEPRECATED: economy v2 removed; converts to v1 mining rate. Drop once no client calls it.';

CREATE OR REPLACE FUNCTION public.add_revenue_event(_source text, _amount_usd numeric, _note text DEFAULT NULL::text, _ref text DEFAULT NULL::text, _created_by uuid DEFAULT NULL::uuid)
 RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT NULL::uuid $function$;
COMMENT ON FUNCTION public.add_revenue_event(text, numeric, text, text, uuid) IS 'DEPRECATED: economy v2 removed (no-op).';

CREATE OR REPLACE FUNCTION public.add_deferred_revenue(_source text, _amount_usd numeric, _ref text DEFAULT NULL::text, _days integer DEFAULT 180)
 RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT NULL::uuid $function$;
COMMENT ON FUNCTION public.add_deferred_revenue(text, numeric, text, integer) IS 'DEPRECATED: economy v2 removed (no-op).';

-- 5) v1 versions of functions that had economy v2 logic.
CREATE OR REPLACE FUNCTION public.atomic_collect_income(_user_id uuid)
 RETURNS TABLE(gained numeric, new_balance numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  rate numeric;
  last_ts timestamptz;
  seconds numeric;
  earned numeric;
  bal numeric;
BEGIN
  SELECT mining_rate, last_collect_at, balance
    INTO rate, last_ts, bal
    FROM public.profiles
   WHERE user_id = _user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
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

CREATE OR REPLACE FUNCTION public.atomic_collect_income_usd(_user_id uuid, _ton_price numeric)
 RETURNS TABLE(gained numeric, new_balance numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  rate_usd numeric;
  last_ts timestamptz;
  seconds numeric;
  earned numeric;
  bal numeric;
BEGIN
  IF _ton_price IS NULL OR _ton_price <= 0 THEN
    RAISE EXCEPTION 'invalid ton price';
  END IF;

  SELECT mining_rate_usd, last_collect_at
    INTO rate_usd, last_ts
    FROM public.profiles
   WHERE user_id = _user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
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

-- complete_task: keeps its signature (extra params ignored) but only records the task.
CREATE OR REPLACE FUNCTION public.complete_task(_user_id uuid, _task_id uuid, _points numeric DEFAULT 0, _days integer DEFAULT 180)
 RETURNS TABLE(reward numeric, completed_on date, points_granted numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  t_reward numeric;
  t_kind text;
  t_active boolean;
  t_min numeric;
  today date := (now() AT TIME ZONE 'utc')::date;
  dep_total numeric;
BEGIN
  SELECT t.reward, t.kind, t.is_active, COALESCE(t.min_deposit, 0)
    INTO t_reward, t_kind, t_active, t_min
  FROM public.tasks t
  WHERE t.id = _task_id
  FOR SHARE;

  IF NOT FOUND OR NOT t_active THEN
    RAISE EXCEPTION 'task not available';
  END IF;

  IF t_min > 0 THEN
    SELECT COALESCE(p.deposit_total, 0) INTO dep_total
    FROM public.profiles p WHERE p.user_id = _user_id;
    IF COALESCE(dep_total, 0) < t_min THEN
      RAISE EXCEPTION 'deposit requirement not met';
    END IF;
  END IF;

  IF t_kind <> 'daily' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_tasks ut
      WHERE ut.user_id = _user_id AND ut.task_id = _task_id
    ) THEN
      RAISE EXCEPTION 'task already completed';
    END IF;
  END IF;

  INSERT INTO public.user_tasks (user_id, task_id, completed_on, reward)
  VALUES (_user_id, _task_id, today, t_reward);

  reward := t_reward;
  completed_on := today;
  points_granted := 0;
  RETURN NEXT;
END;
$function$;

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

-- 6) Mark economy v2 storage as deprecated (kept only until the live app is republished).
COMMENT ON TABLE public.hashrate_grants IS 'DEPRECATED: economy v2 removed; not used by the app.';
COMMENT ON TABLE public.payout_entries IS 'DEPRECATED: economy v2 removed; not used by the app.';
COMMENT ON TABLE public.payout_pool_daily IS 'DEPRECATED: economy v2 removed; not used by the app.';
COMMENT ON TABLE public.revenue_events IS 'DEPRECATED: economy v2 removed; not used by the app.';
COMMENT ON TABLE public.deferred_revenue IS 'DEPRECATED: economy v2 removed; not used by the app.';
COMMENT ON TABLE public.treasury_ledger IS 'DEPRECATED: economy v2 removed; not used by the app.';
COMMENT ON TABLE public.app_settings IS 'DEPRECATED: only held the economy v2 flag; not used by the app.';