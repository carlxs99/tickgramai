CREATE UNIQUE INDEX IF NOT EXISTS hashrate_grants_source_ref_uniq
  ON public.hashrate_grants (source, source_ref_id)
  WHERE source_ref_id IS NOT NULL;