revoke execute on function public.has_role(uuid, app_role) from public, anon;
revoke execute on function public.get_top_miners(int) from public, anon;
grant execute on function public.has_role(uuid, app_role) to authenticated, service_role;
grant execute on function public.get_top_miners(int) to authenticated, service_role;