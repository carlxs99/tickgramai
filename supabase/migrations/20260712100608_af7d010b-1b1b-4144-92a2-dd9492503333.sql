CREATE OR REPLACE FUNCTION public.award_gift_box_on_first_deposit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  anc record;
BEGIN
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  FOR anc IN
    SELECT a.user_id
    FROM public.get_referral_ancestors(NEW.user_id) a
  LOOP
    -- Idempotency: at most one box per (ancestor, deposit).
    IF NOT EXISTS (
      SELECT 1 FROM public.gift_boxes
      WHERE user_id = anc.user_id
        AND source = 'referral'
        AND source_ref_id = NEW.id
    ) THEN
      INSERT INTO public.gift_boxes (user_id, source, source_ref_id)
      VALUES (anc.user_id, 'referral', NEW.id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;