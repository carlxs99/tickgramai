import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type TopMiner = {
  username: string | null;
  first_name: string | null;
  avatar_url: string | null;
  telegram_id: number | null;
  hashrate: number;
  mining_rate: number;
  mining_rate_usd: number;
};

export async function isEconomyV2() {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "economy_v2")
    .maybeSingle();
  return Boolean((data as { value?: { enabled?: boolean } } | null)?.value?.enabled);
}

/** Leaderboard ranked by active hashrate (aggregated in the database). */
export async function topMinersByHashrate(limit = 100): Promise<TopMiner[]> {
  const { data, error } = await supabaseAdmin.rpc("leaderboard_top" as never, {
    _limit: limit,
  } as never);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((p) => ({
    username: (p["username"] as string) ?? null,
    first_name: (p["first_name"] as string) ?? null,
    avatar_url: (p["avatar_url"] as string) ?? null,
    telegram_id: (p["telegram_id"] as number) ?? null,
    hashrate: Number(p["hashrate"] ?? 0),
    mining_rate: Number(p["mining_rate"] ?? 0),
    mining_rate_usd: Number(p["mining_rate_usd"] ?? 0),
  }));
}

/** Rank of a user by active hashrate, excluding admins and banned accounts. */
export async function myRankByHashrate(userId: string) {
  const { data, error } = await supabaseAdmin.rpc("leaderboard_rank" as never, {
    _user_id: userId,
  } as never);
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { rank: number; hashrate: number }
    | null;
  return { rank: Number(row?.rank ?? 0) || 1, hashrate: Number(row?.hashrate ?? 0) };
}


/** Estimated payout pool for today (USD) and current network hashrate.
 *  Mirrors run_daily_payout(): pool = full wallet balance x payout_ratio. */
export async function estimatedPoolToday() {
  const today = new Date().toISOString().slice(0, 10);
  const [ratioRow, pools, net] = await Promise.all([
    supabaseAdmin.from("app_settings").select("value").eq("key", "payout_ratio").maybeSingle(),
    supabaseAdmin
      .from("payout_pool_daily")
      .select("day, pool_usd, status, payout_ratio, treasury_ton")
      .order("day", { ascending: false })
      .limit(7),
    supabaseAdmin.rpc("network_active_hashrate"),
  ]);

  const ratio = Number(
    (ratioRow.data as { value?: { value?: number } } | null)?.value?.value ?? 0.65,
  );
  const poolRows = (pools.data ?? []) as Array<{
    day: string;
    pool_usd: number;
    status?: string;
    treasury_ton?: number | null;
  }>;
  const netHashrate = Number(net.data ?? 0);

  // If today's payout already ran, that row is the source of truth.
  const todayPool = poolRows.find((p) => p.day === today);
  if (todayPool) {
    return { poolUsd: Number(todayPool.pool_usd || 0), netHashrate };
  }

  const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
  const gramPrice = await fetchTonPriceUsdt().catch(() => 0);

  let treasuryTon = Number(poolRows[0]?.treasury_ton ?? 0);
  try {
    const res = await fetch(
      "https://tonapi.io/v2/accounts/UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn",
      { headers: { accept: "application/json" } },
    );
    if (res.ok) {
      const j = (await res.json()) as { balance?: string | number };
      const live = Number(j?.balance ?? 0) / 1e9;
      if (live > 0) treasuryTon = live;
    }
  } catch {
    /* keep snapshot fallback */
  }

  const treasuryUsd = Math.max(treasuryTon, 0) * (gramPrice > 0 ? gramPrice : 0);
  return { poolUsd: Math.max(treasuryUsd * ratio, 0), netHashrate };
}

