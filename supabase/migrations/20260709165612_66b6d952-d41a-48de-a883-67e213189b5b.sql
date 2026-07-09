CREATE OR REPLACE FUNCTION public.get_referral_stats(_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
  inviter_profile json;
  level1_count bigint;
  total_earned numeric(20,6);
  refback_paid_val numeric(20,6);
  refback_rate_val numeric(5,4);
BEGIN
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

  SELECT count(*) INTO level1_count
  FROM public.referrals
  WHERE referrer_id = _user_id;

  SELECT COALESCE(sum(bonus_earned), 0) INTO total_earned
  FROM public.referrals
  WHERE referrer_id = _user_id;

  SELECT refback_paid, refback_rate
  INTO refback_paid_val, refback_rate_val
  FROM public.profiles
  WHERE user_id = _user_id;

  result := json_build_object(
    'inviter', inviter_profile,
    'level1', COALESCE(level1_count, 0),
    'total_referrals', COALESCE(level1_count, 0),
    'total_earned', COALESCE(total_earned, 0),
    'refback_paid', COALESCE(refback_paid_val, 0),
    'refback_rate', COALESCE(refback_rate_val, 0.05)
  );

  RETURN result;
END;
$function$;