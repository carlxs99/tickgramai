-- Recompute affected balances based on the correct 3.3% daily ROI.
-- For every profile: correct balance = sum(user_tasks.reward) + mining accrued
-- since the FIRST confirmed deposit at the current mining_rate.
-- Any excess from older buggy collectIncome versions is removed.
WITH task_rewards AS (
  SELECT user_id, COALESCE(SUM(reward), 0) AS total_reward
  FROM public.user_tasks
  GROUP BY user_id
),
first_deposit AS (
  SELECT user_id, MIN(created_at) AS first_at
  FROM public.deposits
  WHERE status = 'confirmed'
  GROUP BY user_id
),
correct AS (
  SELECT
    p.user_id,
    COALESCE(tr.total_reward, 0)
      + CASE
          WHEN fd.first_at IS NOT NULL AND p.mining_rate > 0
          THEN (p.mining_rate / 86400.0) * GREATEST(0, EXTRACT(EPOCH FROM (now() - fd.first_at)))
          ELSE 0
        END AS correct_balance
  FROM public.profiles p
  LEFT JOIN task_rewards tr ON tr.user_id = p.user_id
  LEFT JOIN first_deposit fd ON fd.user_id = p.user_id
)
UPDATE public.profiles p
SET balance = LEAST(p.balance, c.correct_balance),
    last_collect_at = now()
FROM correct c
WHERE c.user_id = p.user_id
  AND p.balance > c.correct_balance + 0.0001;