CREATE TABLE public.custom_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid,
  status text NOT NULL DEFAULT 'queued',
  message text NOT NULL,
  image_url text,
  button_text text,
  button_url text,
  total integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  progress integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

GRANT SELECT ON public.custom_broadcasts TO authenticated;
GRANT ALL ON public.custom_broadcasts TO service_role;

ALTER TABLE public.custom_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read custom broadcasts"
ON public.custom_broadcasts FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_custom_broadcasts_status ON public.custom_broadcasts (status, created_at);