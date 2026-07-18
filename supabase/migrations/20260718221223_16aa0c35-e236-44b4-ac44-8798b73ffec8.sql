CREATE TABLE IF NOT EXISTS public.broadcast_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total int NOT NULL DEFAULT 0,
  sent int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  last_error text,
  progress int NOT NULL DEFAULT 0
);
GRANT SELECT ON public.broadcast_runs TO authenticated;
GRANT ALL ON public.broadcast_runs TO service_role;
ALTER TABLE public.broadcast_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read broadcast runs" ON public.broadcast_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS idx_broadcast_runs_job_started ON public.broadcast_runs(job, started_at DESC);