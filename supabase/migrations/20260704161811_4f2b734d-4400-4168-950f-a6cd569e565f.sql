CREATE OR REPLACE FUNCTION public.award_gift_box_on_first_deposit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ref_row public.referrals%ROWTYPE;
BEGIN
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
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
  VALUES (ref_row.referrer_id, 'referral', NEW.id);

  RETURN NEW;
END;
$function$;