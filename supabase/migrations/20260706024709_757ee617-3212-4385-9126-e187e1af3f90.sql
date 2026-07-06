
ALTER TABLE public.gift_boxes DROP CONSTRAINT gift_boxes_source_check;
ALTER TABLE public.gift_boxes ADD CONSTRAINT gift_boxes_source_check
  CHECK (source = ANY (ARRAY['referral'::text, 'admin'::text, 'other'::text, 'daily'::text]));
