ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_ip text,
  ADD COLUMN IF NOT EXISTS signup_ip text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_last_ip_idx ON public.profiles (last_ip) WHERE last_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_signup_ip_idx ON public.profiles (signup_ip) WHERE signup_ip IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_detect_multi_accounts(_limit integer DEFAULT 60)
 RETURNS TABLE(group_key text, signal text, account_count integer, accounts jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH groups AS (
    SELECT 'wallet:' || lower(p.wallet_address) AS group_key,
           'shared_wallet'::text AS signal,
           array_agg(DISTINCT p.user_id) AS uids
    FROM public.profiles p
    WHERE coalesce(p.wallet_address, '') <> ''
    GROUP BY lower(p.wallet_address)
    HAVING count(DISTINCT p.user_id) > 1

    UNION ALL

    SELECT 'payout:' || lower(w.address),
           'shared_payout_address',
           array_agg(DISTINCT w.user_id)
    FROM public.withdrawals w
    WHERE coalesce(w.address, '') <> ''
    GROUP BY lower(w.address)
    HAVING count(DISTINCT w.user_id) > 1

    UNION ALL

    SELECT 'ip:' || p.last_ip,
           'shared_ip',
           array_agg(DISTINCT p.user_id)
    FROM public.profiles p
    WHERE coalesce(p.last_ip, '') <> ''
    GROUP BY p.last_ip
    HAVING count(DISTINCT p.user_id) > 1

    UNION ALL

    SELECT 'signupip:' || p.signup_ip,
           'shared_signup_ip',
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
           array_agg(DISTINCT p.user_id)
    FROM public.profiles p
    WHERE coalesce(p.avatar_url, '') <> ''
    GROUP BY p.avatar_url
    HAVING count(DISTINCT p.user_id) > 1

    UNION ALL

    SELECT 'refburst:' || p.referred_by::text || ':' || to_char(date_trunc('hour', p.created_at), 'YYYY-MM-DD HH24'),
           'referral_burst',
           array_agg(DISTINCT p.user_id)
    FROM public.profiles p
    WHERE p.referred_by IS NOT NULL
    GROUP BY p.referred_by, date_trunc('hour', p.created_at)
    HAVING count(*) >= 5 AND count(*) FILTER (WHERE p.deposit_total > 0) = 0
  )
  SELECT g.group_key,
         g.signal,
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
  ORDER BY cardinality(g.uids) DESC
  LIMIT least(_limit, 200)
$function$;

REVOKE ALL ON FUNCTION public.admin_detect_multi_accounts(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_detect_multi_accounts(integer) TO service_role;