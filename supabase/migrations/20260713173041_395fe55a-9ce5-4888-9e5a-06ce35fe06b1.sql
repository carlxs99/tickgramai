CREATE OR REPLACE FUNCTION public.claim_daily_gift_box(_user_id uuid)
 RETURNS TABLE(box_id uuid, next_claim_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  last_ts timestamptz;
  new_box_id uuid;
BEGIN
  SELECT last_daily_gift_at INTO last_ts
  FROM public.profiles
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF last_ts IS NOT NULL AND last_ts > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'daily gift box not available yet' USING ERRCODE = 'P0001';
  END IF;

  WITH inserted AS (
    INSERT INTO public.gift_boxes (user_id, source)
    VALUES (_user_id, 'daily'), (_user_id, 'daily'), (_user_id, 'daily')
    RETURNING id
  )
  SELECT id INTO new_box_id FROM inserted LIMIT 1;

  UPDATE public.profiles
     SET last_daily_gift_at = now()
   WHERE user_id = _user_id;

  box_id := new_box_id;
  next_claim_at := now() + interval '24 hours';
  RETURN NEXT;
END;
$function$;