import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// List the caller's gift boxes + active deposit bonus (if any).
export const listGiftBoxes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [boxes, bonus] = await Promise.all([
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
    ]);
    if (boxes.error) throw boxes.error;
    const list = boxes.data ?? [];
    const unopenedCount = list.filter((b: any) => b.status === "unopened").length;
    return {
      boxes: list,
      unopenedCount,
      activeBonus: bonus.data ?? null,
    };
  });

// Open a gift box. GATED to admin during Coming Soon phase — non-admins are
// rejected server-side even if the UI is bypassed.
export const openGiftBox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { boxId: string }) => z.object({ boxId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Admin-only until public launch.
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Gift boxes coming soon");

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
