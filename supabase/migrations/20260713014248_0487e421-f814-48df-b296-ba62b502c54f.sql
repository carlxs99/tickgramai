CREATE OR REPLACE FUNCTION public.claim_referral_milestone(_tier smallint)
 RETURNS TABLE(reward numeric, new_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  t_required integer;
  t_reward numeric;
  active bigint;
  new_bal numeric;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Look up the tier from the canonical inline table (never trust client)
  SELECT t.required, t.reward INTO t_required, t_reward
  FROM (VALUES
      (1::smallint, 1,   0.005::numeric),
      (2::smallint, 3,   0.02::numeric),
      (3::smallint, 5,   0.05::numeric),
      (4::smallint, 10,  0.15::numeric),
      (5::smallint, 25,  0.5::numeric),
      (6::smallint, 50, 1::numeric),
      (7::smallint, 100, 3::numeric)
    ) AS t(tier, required, reward)
  WHERE t.tier = _tier;

  IF t_required IS NULL THEN
    RAISE EXCEPTION 'invalid milestone tier';
  END IF;

  -- Idempotency: reserve the claim row first
  BEGIN
    INSERT INTO public.referral_milestone_claims (user_id, tier, reward)
    VALUES (caller_id, _tier, t_reward);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'milestone already claimed';
  END;

  -- Verify active referrals (level 1, referred user has confirmed deposits)
  SELECT COUNT(*) INTO active
  FROM public.referrals r
  JOIN public.profiles p ON p.user_id = r.referred_id
  WHERE r.referrer_id = caller_id
    AND COALESCE(p.deposit_total, 0) > 0;

  IF active < t_required THEN
    -- Roll back the claim so the user can retry after reaching the threshold
    DELETE FROM public.referral_milestone_claims
    WHERE user_id = caller_id AND tier = _tier;
    RAISE EXCEPTION 'not enough active referrals: % / %', active, t_required;
  END IF;

  -- Credit balance
  UPDATE public.profiles
     SET balance = COALESCE(balance, 0) + t_reward
   WHERE user_id = caller_id
  RETURNING balance INTO new_bal;

  IF new_bal IS NULL THEN
    -- Profile missing: undo
    DELETE FROM public.referral_milestone_claims
    WHERE user_id = caller_id AND tier = _tier;
    RAISE EXCEPTION 'profile not found';
  END IF;

  reward := t_reward;
  new_balance := new_bal;
  RETURN NEXT;
END;
$function$;