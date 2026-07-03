
-- 1) Restringe qué columnas puede modificar un usuario en su propio perfil.
--    Antes: cualquier columna (balance, mining_rate, deposit_total, memo_tag,
--    referral_code, referred_by). Ahora: sólo cosméticas + wallet + idioma.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (wallet_address, language_code, username, first_name, last_name, avatar_url)
  ON public.profiles TO authenticated;
-- service_role mantiene UPDATE completo (ya cubierto por GRANT ALL previo).
GRANT ALL ON public.profiles TO service_role;

-- 2) Revoca EXECUTE público del SECURITY DEFINER; sólo service_role lo llama.
REVOKE EXECUTE ON FUNCTION public.get_top_miners(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_miners(int) TO service_role;
