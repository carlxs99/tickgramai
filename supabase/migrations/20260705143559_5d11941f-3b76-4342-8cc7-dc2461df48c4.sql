CREATE OR REPLACE FUNCTION public.get_top_miners(_limit integer DEFAULT 20)
 RETURNS TABLE(username text, first_name text, avatar_url text, mining_rate numeric, mining_rate_usd numeric, balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.username, p.first_name, p.avatar_url, p.mining_rate, p.mining_rate_usd, p.balance
  from public.profiles p
  where not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p.user_id and ur.role = 'admin'
  )
  order by p.mining_rate_usd desc, p.balance desc
  limit least(_limit, 100)
$function$;