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

/** Estimated payout pool for today (USD) and current network hashrate. */
export async function estimatedPoolToday() {
  const today = new Date().toISOString().slice(0, 10);
  const [ratioRow, revToday, deferred, pools, net] = await Promise.all([
    supabaseAdmin.from("app_settings").select("value").eq("key", "payout_ratio").maybeSingle(),
    supabaseAdmin
      .from("revenue_events")
      .select("amount_usd")
      .gte("occurred_at", `${today}T00:00:00Z`),
    supabaseAdmin
      .from("deferred_revenue")
      .select("daily_usd")
      .lte("starts_on", today)
      .gte("ends_on", today)
      .limit(5000),
    supabaseAdmin
      .from("payout_pool_daily")
      .select("day, pool_usd, status, payout_ratio")
      .order("day", { ascending: false })
      .limit(7),
    supabaseAdmin.rpc("network_active_hashrate"),
  ]);

  const ratio = Number(
    (ratioRow.data as { value?: { value?: number } } | null)?.value?.value ?? 0.65,
  );
  const revenue =
    ((revToday.data ?? []) as Array<{ amount_usd: number }>).reduce(
      (s, r) => s + Number(r.amount_usd || 0),
      0,
    ) +
    ((deferred.data ?? []) as Array<{ daily_usd: number }>).reduce(
      (s, r) => s + Number(r.daily_usd || 0),
      0,
    );
  const poolRows = (pools.data ?? []) as Array<{
    day: string;
    pool_usd: number;
    status?: string;
    payout_ratio?: number;
  }>;
  const todayPool = poolRows.find((p) => p.day === today);
  if (todayPool) {
    return { poolUsd: Number(todayPool.pool_usd || 0), netHashrate: Number(net.data ?? 0) };
  }
  const donePools = poolRows.filter((p) => p.status === "done" && p.day < today);
  const avgPool =
    donePools.length > 0
      ? donePools.reduce((s, p) => s + Number(p.pool_usd || 0), 0) / donePools.length
      : 0;
  // Mirror run_daily_payout(): solvency-capped ratio + 0.7x-1.3x smoothing band.
  const lastEffective = donePools.find((p) => Number(p.pool_usd || 0) > 0);
  const effectiveRatio =
    lastEffective?.payout_ratio != null
      ? Math.min(ratio, Number(lastEffective.payout_ratio))
      : ratio;
  let poolUsd = Math.max(revenue * effectiveRatio, 0);
  if (avgPool > 0) poolUsd = Math.min(Math.max(poolUsd, avgPool * 0.7), avgPool * 1.3);

  return {
    poolUsd,
    netHashrate: Number(net.data ?? 0),
  };
}
