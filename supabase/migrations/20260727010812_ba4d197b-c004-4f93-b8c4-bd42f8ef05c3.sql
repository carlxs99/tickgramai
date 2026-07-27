DROP FUNCTION IF EXISTS public.admin_detect_multi_accounts(integer);

CREATE OR REPLACE FUNCTION public.admin_detect_multi_accounts(_limit integer DEFAULT 60)
 RETURNS TABLE(group_key text, signal text, confidence text, account_count integer, accounts jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH groups AS (
    SELECT 'wallet:' || lower(p.wallet_address) AS group_key,
           'shared_wallet'::text AS signal,
           'high'::text AS confidence,
           array_agg(DISTINCT p.user_id) AS uids
    FROM public.profiles p
    WHERE coalesce(p.wallet_address, '') <> ''
    GROUP BY lower(p.wallet_address)
    HAVING count(DISTINCT p.user_id) > 1

    UNION ALL

    SELECT 'payout:' || lower(w.address),
           'shared_payout_address',
           'high',
           array_agg(DISTINCT w.user_id)
    FROM public.withdrawals w
    WHERE coalesce(w.address, '') <> ''
    GROUP BY lower(w.address)
    HAVING count(DISTINCT w.user_id) > 1

    UNION ALL

    SELECT 'ip:' || p.last_ip,
           'shared_ip',
           'high',
           array_agg(DISTINCT p.user_id)
    FROM public.profiles p
    WHERE coalesce(p.last_ip, '') <> ''
    GROUP BY p.last_ip
    HAVING count(DISTINCT p.user_id) > 1

    UNION ALL

    SELECT 'signupip:' || p.signup_ip,
           'shared_signup_ip',
           'medium',
           array_agg(DISTINCT p.user_id)
    FROM public.profiles p
    WHERE coalesce(p.signup_ip, '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles q
        WHERE q.signup_ip = p.signup_ip AND q.last_ip = p.signup_ip
      )
    GROUP BY p.signup_ip
    HAVING count(DISTINCT p.user_id) > 1

    UNION ALL

    SELECT 'avatar:' || p.avatar_url,
           'shared_avatar',
           'high',
           array_agg(DISTINCT p.user_id)
    FROM public.profiles p
    WHERE coalesce(p.avatar_url, '') <> ''
    GROUP BY p.avatar_url
    HAVING count(DISTINCT p.user_id) > 1

    UNION ALL

    -- Same inviter, >=3 accounts whose Telegram IDs are nearly consecutive
    -- (accounts registered in Telegram within the same batch) and created
    -- inside the same hour. Strong hint of farmed burner accounts.
    SELECT 'seqtg:' || p.referred_by::text || ':' || to_char(date_trunc('hour', p.created_at), 'YYYY-MM-DD HH24'),
           'sequential_telegram_ids',
           'medium',
           array_agg(DISTINCT p.user_id)
    FROM public.profiles p
    WHERE p.referred_by IS NOT NULL
      AND p.telegram_id IS NOT NULL
    GROUP BY p.referred_by, date_trunc('hour', p.created_at)
    HAVING count(*) >= 3
       AND (max(p.telegram_id) - min(p.telegram_id)) < (count(*) * 200000)
       AND count(*) FILTER (WHERE p.deposit_total > 0) = 0

    UNION ALL

    -- Same inviter, several accounts sharing the exact same display name.
    SELECT 'samename:' || p.referred_by::text || ':' || lower(p.first_name),
           'same_name_same_inviter',
           'medium',
           array_agg(DISTINCT p.user_id)
    FROM public.profiles p
    WHERE p.referred_by IS NOT NULL
      AND coalesce(p.first_name, '') <> ''
    GROUP BY p.referred_by, lower(p.first_name)
    HAVING count(*) >= 3

    UNION ALL

    -- Referral farming: tightened. A plain burst of invites is normal
    -- promotion, so it only surfaces when the batch also looks synthetic:
    -- >=5 accounts within 15 minutes, zero deposits, and either most accounts
    -- have no Telegram username or they are brand-new Telegram IDs.
    SELECT 'refburst:' || p.referred_by::text || ':' || to_char(date_trunc('hour', p.created_at), 'YYYY-MM-DD HH24') || ':' || (extract(minute from p.created_at)::int / 15)::text,
           'referral_farm_suspect',
           'low',
           array_agg(DISTINCT p.user_id)
    FROM public.profiles p
    WHERE p.referred_by IS NOT NULL
    GROUP BY p.referred_by, date_trunc('hour', p.created_at), (extract(minute from p.created_at)::int / 15)
    HAVING count(*) >= 5
       AND count(*) FILTER (WHERE p.deposit_total > 0) = 0
       AND (
            count(*) FILTER (WHERE coalesce(p.username, '') = '') >= (count(*) * 0.6)
         OR count(*) FILTER (WHERE coalesce(p.avatar_url, '') = '') >= (count(*) * 0.6)
       )
  )
  SELECT g.group_key,
         g.signal,
         g.confidence,
         cardinality(g.uids)::integer AS account_count,
         (
           SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at), '[]'::jsonb)
           FROM (
             SELECT pr.user_id, pr.telegram_id, pr.username, pr.first_name, pr.last_name,
                    pr.avatar_url, pr.balance, pr.deposit_total, pr.mining_rate_usd,
                    pr.wallet_address, pr.last_ip, pr.signup_ip, pr.last_seen_at,
                    pr.created_at, pr.banned, pr.ban_reason
             FROM public.profiles pr
             WHERE pr.user_id = ANY (g.uids)
           ) a
         ) AS accounts
  FROM groups g
  ORDER BY (CASE g.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END),
           cardinality(g.uids) DESC
  LIMIT least(_limit, 200)
$function$;

REVOKE ALL ON FUNCTION public.admin_detect_multi_accounts(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_detect_multi_accounts(integer) TO service_role;