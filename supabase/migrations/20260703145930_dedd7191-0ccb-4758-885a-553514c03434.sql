
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS memo_tag text UNIQUE,
  ADD COLUMN IF NOT EXISTS wallet_address text;

CREATE OR REPLACE FUNCTION public.generate_memo_tag()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  candidate text;
  tries int := 0;
BEGIN
  LOOP
    candidate := upper(substr(replace(replace(gen_random_uuid()::text, '-', ''), '0', 'H'), 1, 10));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE memo_tag = candidate);
    tries := tries + 1;
    IF tries > 20 THEN RAISE EXCEPTION 'could not generate unique memo'; END IF;
  END LOOP;
  RETURN candidate;
END;
$$;

UPDATE public.profiles SET memo_tag = public.generate_memo_tag() WHERE memo_tag IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN memo_tag SET DEFAULT public.generate_memo_tag(),
  ALTER COLUMN memo_tag SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.processed_tx (
  tx_hash text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  memo text,
  amount_ton numeric NOT NULL,
  gram_credited numeric NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.processed_tx TO authenticated;
GRANT ALL ON public.processed_tx TO service_role;

ALTER TABLE public.processed_tx ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own processed tx"
  ON public.processed_tx FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
