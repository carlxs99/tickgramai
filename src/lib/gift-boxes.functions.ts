import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// List the caller's gift boxes + active deposit bonus (if any) + daily claim state.
export const listGiftBoxes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [boxes, bonus, profile] = await Promise.all([
      supabase
        .from("gift_boxes")
        .select("id, status, prize_type, prize_amount, opened_at, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("deposit_bonuses")
        .select("id, percent, expires_at, used_at, created_at")
        .eq("user_id", userId)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("last_daily_gift_at")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (boxes.error) throw boxes.error;
    const list = boxes.data ?? [];
    const unopenedCount = list.filter((b: any) => b.status === "unopened").length;
    const lastDaily = (profile.data as any)?.last_daily_gift_at ?? null;
    const nextDailyAt = lastDaily
      ? new Date(new Date(lastDaily).getTime() + 24 * 60 * 60 * 1000).toISOString()
      : null;
    const canClaimDaily = !nextDailyAt || new Date(nextDailyAt).getTime() <= Date.now();
    return {
      boxes: list,
      unopenedCount,
      activeBonus: bonus.data ?? null,
      canClaimDaily,
      nextDailyAt,
    };
  });

// Claim the free daily gift box (24h cooldown).
export const claimDailyGiftBox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .rpc("claim_daily_gift_box" as never, { _user_id: userId } as never);
    if (error) throw error;
    const r: any = Array.isArray(row) ? row[0] : row;
    return {
      boxId: String(r?.box_id ?? ""),
      nextClaimAt: r?.next_claim_at ?? null,
    };
  });

// Open a gift box.
export const openGiftBox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { boxId: string }) => z.object({ boxId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");


    const { data: row, error } = await supabaseAdmin
      .rpc("open_gift_box" as never, { _user_id: userId, _box_id: data.boxId } as never);
    if (error) throw error;
    const r: any = Array.isArray(row) ? row[0] : row;
    return {
      prizeType: String(r?.prize_type ?? ""),
      prizeAmount: Number(r?.prize_amount ?? 0),
      miningRateGram: r?.mining_rate_gram != null ? Number(r.mining_rate_gram) : null,
      bonusExpiresAt: r?.bonus_expires_at ?? null,
    };
  });
