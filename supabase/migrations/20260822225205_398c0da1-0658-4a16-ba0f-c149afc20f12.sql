UPDATE public.profiles
SET mining_rate = 0, mining_rate_usd = 0
WHERE mining_rate <> 0 OR mining_rate_usd <> 0;