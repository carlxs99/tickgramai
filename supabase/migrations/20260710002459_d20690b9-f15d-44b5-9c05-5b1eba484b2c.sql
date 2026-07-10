
-- ============================================================
-- 3-level referral system
-- L1: 10% direct, L2: 5%, L3: 3% (of the deposit, credited to balance).
-- Refback (each ancestor's refback_rate) is deducted from that ancestor's
-- commission and credited to the depositor.
-- Chain is derived from profiles.referred_by (which references profiles.id).
-- ============================================================

-- Accumulator for total commissions earned across all levels.
-- Existing bonus_earned in `referrals` is preserved for the L1 per-friend view;
-- this column aggregates across L1+L2+L3 for the stats card.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_earned_total numeric(20,6) NOT NULL DEFAULT 0;

-- Backfill from existing L1 commissions.
UPDATE public.profiles p
   SET referral_earned_total = COALESCE(sub.s, 0)
  FROM (
    SELECT referrer_id, SUM(COALESCE(bonus_earned, 0)) AS s
    FROM public.referrals
    GROUP BY referrer_id
  ) sub
 WHERE sub.referrer_id = p.user_id;

-- Return up to 3 ancestor referrers, walking profiles.referred_by upward.
-- level 1 = direct referrer, 2 = grandparent, 3 = great-grandparent.
CREATE OR REPLACE FUNCTION public.get_referral_ancestors(_user_id uuid)
RETURNS TABLE(
  level int,
  user_id uuid,
  telegram_id bigint,
  first_name text,
  refback_rate numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cur_profile_id uuid;
  parent_profile_id uuid;
  parent_user_id uuid;
  parent_tg bigint;
  parent_first text;
  parent_refback numeric;
  lvl int := 0;
BEGIN
  SELECT referred_by INTO cur_profile_id
  FROM public.profiles
  WHERE profiles.user_id = _user_id;

  WHILE cur_profile_id IS NOT NULL AND lvl < 3 LOOP
    lvl := lvl + 1;
    SELECT p.user_id, p.telegram_id, p.first_name, COALESCE(p.refback_rate, 0), p.referred_by
      INTO parent_user_id, parent_tg, parent_first, parent_refback, parent_profile_id
    FROM public.profiles p
    WHERE p.id = cur_profile_id;

    IF NOT FOUND OR parent_user_id IS NULL THEN
      EXIT;
    END IF;

    -- Cycle guard: never return the depositor as their own ancestor.
    IF parent_user_id = _user_id THEN
      EXIT;
    END IF;

    level := lvl;
    user_id := parent_user_id;
    telegram_id := parent_tg;
    first_name := parent_first;
    refback_rate := parent_refback;
    RETURN NEXT;

    cur_profile_id := parent_profile_id;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_referral_ancestors(uuid) TO authenticated, service_role;

-- Rewrite stats to compute L1/L2/L3 counts by walking descendants of the user
-- through profiles.referred_by. Only referrals inserted at signup (level 1)
-- exist as rows; L2/L3 counts are inferred from the chain.
CREATE OR REPLACE FUNCTION public.get_referral_stats(_user_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result json;
  inviter_profile json;
  my_profile_id uuid;
  level1_count bigint := 0;
  level2_count bigint := 0;
  level3_count bigint := 0;
  total_earned_val numeric(20,6);
  refback_paid_val numeric(20,6);
  refback_rate_val numeric(5,4);
BEGIN
  SELECT id INTO my_profile_id FROM public.profiles WHERE profiles.user_id = _user_id;

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

  IF my_profile_id IS NOT NULL THEN
    WITH RECURSIVE tree AS (
      SELECT p.id, p.user_id, 1 AS depth
      FROM public.profiles p
      WHERE p.referred_by = my_profile_id
      UNION ALL
      SELECT p.id, p.user_id, tree.depth + 1
      FROM public.profiles p
      JOIN tree ON p.referred_by = tree.id
      WHERE tree.depth < 3
    )
    SELECT
      COUNT(*) FILTER (WHERE depth = 1),
      COUNT(*) FILTER (WHERE depth = 2),
      COUNT(*) FILTER (WHERE depth = 3)
    INTO level1_count, level2_count, level3_count
    FROM tree;
  END IF;

  SELECT COALESCE(referral_earned_total, 0),
         COALESCE(refback_paid, 0),
         COALESCE(refback_rate, 0.05)
  INTO total_earned_val, refback_paid_val, refback_rate_val
  FROM public.profiles
  WHERE profiles.user_id = _user_id;

  -- Fallback: if referral_earned_total is somehow 0 but per-friend rows exist.
  IF COALESCE(total_earned_val, 0) = 0 THEN
    SELECT COALESCE(sum(bonus_earned), 0) INTO total_earned_val
    FROM public.referrals WHERE referrer_id = _user_id;
  END IF;

  result := json_build_object(
    'inviter', inviter_profile,
    'level1', COALESCE(level1_count, 0),
    'level2', COALESCE(level2_count, 0),
    'level3', COALESCE(level3_count, 0),
    'total_referrals', COALESCE(level1_count, 0) + COALESCE(level2_count, 0) + COALESCE(level3_count, 0),
    'total_earned', COALESCE(total_earned_val, 0),
    'refback_paid', COALESCE(refback_paid_val, 0),
    'refback_rate', COALESCE(refback_rate_val, 0.05)
  );

  RETURN result;
END;
$$;
