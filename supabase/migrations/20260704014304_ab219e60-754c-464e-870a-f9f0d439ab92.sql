ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mining_rate_usd numeric NOT NULL DEFAULT 0;

UPDATE public.profiles
   SET mining_rate_usd = COALESCE(mining_rate, 0) * 1.60
 WHERE mining_rate_usd = 0
   AND COALESCE(mining_rate, 0) > 0;

CREATE OR REPLACE FUNCTION public.atomic_collect_income_usd(_user_id uuid, _ton_price numeric)
RETURNS TABLE(gained numeric, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

DROP FUNCTION IF EXISTS public.get_top_miners(integer);

CREATE OR REPLACE FUNCTION public.get_top_miners(_limit integer DEFAULT 20)
 RETURNS TABLE(username text, first_name text, avatar_url text, mining_rate numeric, mining_rate_usd numeric, balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select username, first_name, avatar_url, mining_rate, mining_rate_usd, balance
  from public.profiles
  order by mining_rate_usd desc, balance desc
  limit least(_limit, 100)
$function$;