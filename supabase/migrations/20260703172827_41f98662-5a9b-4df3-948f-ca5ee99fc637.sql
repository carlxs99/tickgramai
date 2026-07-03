ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mining_rate_usdt numeric NOT NULL DEFAULT 0;
-- Backfill: existing mining_rate is in TON/day. Convert to USDT/day using current TON price snapshot.
UPDATE public.profiles SET mining_rate_usdt = mining_rate * 1.60 WHERE mining_rate_usdt = 0 AND mining_rate > 0;