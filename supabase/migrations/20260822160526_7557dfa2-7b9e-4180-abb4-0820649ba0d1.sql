-- Backfill deferred revenue for historical deposits so the daily payout pool is not zero.
-- Total historical confirmed deposits valued at ~1.32 USD per GRAM, amortized over 180 days.
INSERT INTO public.deferred_revenue (source, ref, amount_usd, daily_usd, starts_on, ends_on)
SELECT 'deposit_backfill',
       'legacy_deposits_2026_08_22',
       ROUND(total_usd, 6),
       ROUND(total_usd / 180.0, 8),
       CURRENT_DATE,
       CURRENT_DATE + 179
FROM (
  SELECT COALESCE(SUM(amount_ton), 0) * 1.32 AS total_usd
  FROM public.deposits
  WHERE status IN ('confirmed', 'completed')
) s
WHERE s.total_usd > 0
ON CONFLICT DO NOTHING;