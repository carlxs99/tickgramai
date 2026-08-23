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

async function getAdminIds() {
  const { data } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
  return (data ?? []).map((r) => r.user_id).filter(Boolean) as string[];
}

export async function isEconomyV2() {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "economy_v2")
    .maybeSingle();
  return Boolean((data as { value?: { enabled?: boolean } } | null)?.value?.enabled);
}

/** Sum of active (non-expired) hashrate points per user. */
export async function activeHashrateByUser() {
  const nowIso = new Date().toISOString();
  const map = new Map<string, number>();
  const pageSize = 1000;
  for (let from = 0; from < 50_000; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("hashrate_grants")
      .select("user_id, points")
      .eq("active", true)
      .gt("expires_at", nowIso)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ user_id: string; points: number }>;
    for (const r of rows) {
      map.set(r.user_id, (map.get(r.user_id) ?? 0) + Number(r.points || 0));
    }
    if (rows.length < pageSize) break;
  }
  return map;
}

/** Leaderboard ranked by active hashrate (Dynamic Mining v2). */
export async function topMinersByHashrate(limit = 100): Promise<TopMiner[]> {
  const [adminIds, hashMap] = await Promise.all([getAdminIds(), activeHashrateByUser()]);
  const adminSet = new Set(adminIds);
  const ranked = [...hashMap.entries()]
    .filter(([userId]) => !adminSet.has(userId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  if (ranked.length === 0) return [];

  const ids = ranked.map(([id]) => id);
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, username, first_name, avatar_url, telegram_id, mining_rate, mining_rate_usd, banned")
    .in("user_id", ids);
  if (error) throw error;
  const byId = new Map(
    ((data ?? []) as Array<Record<string, unknown>>).map((p) => [p["user_id"] as string, p]),
  );

  return ranked
    .filter(([userId]) => !(byId.get(userId)?.["banned"] as boolean))
    .map(([userId, points]) => {
    const p = byId.get(userId) ?? {};
    return {
      username: (p["username"] as string) ?? null,
      first_name: (p["first_name"] as string) ?? null,
      avatar_url: (p["avatar_url"] as string) ?? null,
      telegram_id: (p["telegram_id"] as number) ?? null,
      hashrate: points,
      mining_rate: Number(p["mining_rate"] ?? 0),
      mining_rate_usd: Number(p["mining_rate_usd"] ?? 0),
    };
  });
}

/** Rank of a user by active hashrate, excluding admins. */
export async function myRankByHashrate(userId: string) {
  const [adminIds, hashMap] = await Promise.all([getAdminIds(), activeHashrateByUser()]);
  const adminSet = new Set(adminIds);
  const mine = hashMap.get(userId) ?? 0;
  let ahead = 0;
  for (const [id, pts] of hashMap) {
    if (id !== userId && !adminSet.has(id) && pts > mine) ahead++;
  }
  return { rank: ahead + 1, hashrate: mine };
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

