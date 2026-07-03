-- Restaurar los GRANTs necesarios sobre public.profiles que se perdieron.
-- authenticated: SELECT completo (RLS filtra las filas) + UPDATE sólo en columnas cosméticas.
-- service_role: acceso total (necesario para las funciones de servidor que mutan balance/mining_rate/etc).
-- anon: sin acceso.

GRANT SELECT, INSERT, DELETE ON public.profiles TO authenticated;
GRANT UPDATE (wallet_address, language_code, username, first_name, last_name, avatar_url)
  ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;