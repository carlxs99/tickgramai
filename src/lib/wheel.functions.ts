import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotBanned } from "@/lib/ban-guard";

// Prize wheel: users earn 1 spin per full $10 of a single deposit.
// Spins expire after 7 days. All prize logic lives in the DB (spin_wheel RPC).

export const listWheelSpins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.rpc("expire_stale_wheel_spins" as never, { _user_id: userId } as never);
    } catch {
      // non-fatal
    }

    const [available, history] = await Promise.all([
      supabase
        .from("wheel_spins")
        .select("id, expires_at")
        .eq("user_id", userId)
        .eq("status", "available")
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: true }),
      supabase
        .from("wheel_spins")
        .select("id, prize_type, prize_amount, used_at")
        .eq("user_id", userId)
        .eq("status", "used")
        .order("used_at", { ascending: false })
        .limit(10),
    ]);
    if (available.error) throw available.error;

    const list = (available.data ?? []) as Array<{ id: string; expires_at: string }>;
    return {
      spins: list.length,
      nextExpiryAt: list[0]?.expires_at ?? null,
      history: (history.data ?? []) as Array<{
        id: string;
        prize_type: string | null;
        prize_amount: number | null;
        used_at: string | null;
      }>,
    };
  });

export const spinWheel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    await assertNotBanned(userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchTonPriceUsdt } = await import("@/lib/prices.functions");
    let price = 1;
    try {
      const p = await fetchTonPriceUsdt();
      if (p > 0) price = p;
    } catch {
      // keep fallback
    }

    const { data, error } = await supabaseAdmin.rpc("spin_wheel" as never, {
      _user_id: userId,
      _gram_price: price,
    } as never);
    if (error) throw new Error(error.message);

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          prize_type: string;
          prize_amount: number;
          spins_left: number;
          new_mining_rate: number | null;
          bonus_expires_at: string | null;
        }
      | undefined;
    if (!row) throw new Error("no spins available");

    return {
      prizeType: row.prize_type,
      prizeAmount: Number(row.prize_amount ?? 0),
      spinsLeft: Number(row.spins_left ?? 0),
      newMiningRate: row.new_mining_rate == null ? null : Number(row.new_mining_rate),
      bonusExpiresAt: row.bonus_expires_at ?? null,
    };
  });
