-- Multi-level referral stats + refback tracking

-- Cashback the user gives back to their direct referrals on each deposit.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS refback_paid numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refback_rate numeric(5,4) NOT NULL DEFAULT 0.05;

-- Returns a JSON blob with everything the Friends/Referrals screen needs:
-- inviter, per-level counts (1-3), total referral count, total earned,
-- and refback settings.
CREATE OR REPLACE FUNCTION public.get_referral_stats(_user_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  inviter_profile json;
  level1_count bigint;
  level2_count bigint;
  level3_count bigint;
  total_earned numeric(20,6);
  refback_paid_val numeric(20,6);
  refback_rate_val numeric(5,4);
BEGIN
  -- Inviter (who invited me)
  SELECT json_build_object(
    'user_id', p.user_id,
    'username', p.username,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'avatar_url', p.avatar_url
  ) INTO inviter_profile
  FROM public.profiles me
  JOIN public.profiles p ON p.id = me.referred_by
  WHERE me.user_id = _user_id;

  -- Level 1: direct referrals
  SELECT count(*) INTO level1_count
  FROM public.referrals
  WHERE referrer_id = _user_id;

  -- Level 2: referrals of my level-1 referrals
  SELECT count(*) INTO level2_count
  FROM public.referrals r2
  JOIN public.referrals r1 ON r1.referred_id = r2.referrer_id
  WHERE r1.referrer_id = _user_id;

  -- Level 3: referrals of my level-2 referrals
  SELECT count(*) INTO level3_count
  FROM public.referrals r3
  JOIN public.referrals r2 ON r2.referred_id = r3.referrer_id
  JOIN public.referrals r1 ON r1.referred_id = r2.referrer_id
  WHERE r1.referrer_id = _user_id;

  -- Total earned: sum of direct referral bonuses (matches existing 10% direct commission).
  SELECT COALESCE(sum(bonus_earned), 0) INTO total_earned
  FROM public.referrals
  WHERE referrer_id = _user_id;

  -- Refback settings
  SELECT refback_paid, refback_rate
  INTO refback_paid_val, refback_rate_val
  FROM public.profiles
  WHERE user_id = _user_id;

  result := json_build_object(
    'inviter', inviter_profile,
    'level1', COALESCE(level1_count, 0),
    'level2', COALESCE(level2_count, 0),
    'level3', COALESCE(level3_count, 0),
    'total_referrals', COALESCE(level1_count, 0) + COALESCE(level2_count, 0) + COALESCE(level3_count, 0),
    'total_earned', COALESCE(total_earned, 0),
    'refback_paid', COALESCE(refback_paid_val, 0),
    'refback_rate', COALESCE(refback_rate_val, 0.05)
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_referral_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_referral_stats(uuid) TO service_role;
