-- Defense in depth: explicit deny write policies (grants already SELECT-only)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.deposit_bonuses, public.gift_boxes, public.wheel_spins FROM anon, authenticated;

CREATE POLICY "deposit_bonuses deny insert" ON public.deposit_bonuses FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "deposit_bonuses deny update" ON public.deposit_bonuses FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "deposit_bonuses deny delete" ON public.deposit_bonuses FOR DELETE TO authenticated, anon USING (false);

CREATE POLICY "gift_boxes deny insert" ON public.gift_boxes FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "gift_boxes deny update" ON public.gift_boxes FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "gift_boxes deny delete" ON public.gift_boxes FOR DELETE TO authenticated, anon USING (false);

CREATE POLICY "wheel_spins deny insert" ON public.wheel_spins FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "wheel_spins deny update" ON public.wheel_spins FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "wheel_spins deny delete" ON public.wheel_spins FOR DELETE TO authenticated, anon USING (false);