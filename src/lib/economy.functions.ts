import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotBanned } from "@/lib/ban-guard";

/** User-facing network mining stats (hashrate, share, last payout, 7d APY). */
export const getNetworkMining = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const today = new Date().toISOString().slice(0, 10);
    const [mine, net, flag, pools, entries, ratioRow, revToday, deferred, pending] = await Promise.all([
      supabaseAdmin.rpc("user_active_hashrate", { _user_id: userId }),
      supabaseAdmin.rpc("network_active_hashrate"),
      supabaseAdmin.from("app_settings").select("value").eq("key", "economy_v2").maybeSingle(),
      supabaseAdmin
        .from("payout_pool_daily")
        .select("day, pool_usd, total_hashrate, paid_usd, users_paid, solvency_ratio, status, payout_ratio")
        .order("day", { ascending: false })
        .limit(7),
      supabaseAdmin
        .from("payout_entries")
        .select("day, amount_usd, amount_gram, share")
        .eq("user_id", userId)
        .order("day", { ascending: false })
        .limit(7),
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
        .from("payout_entries")
        .select("day, amount_gram, amount_usd")
        .eq("user_id", userId)
        .is("claimed_at", null)
        .limit(365),
    ]);

    const pendingRows = (pending.data ?? []) as Array<{ day: string; amount_gram: number }>;
    const pendingGram = pendingRows.reduce((s, r) => s + Number(r.amount_gram || 0), 0);


    const myHashrate = Number(mine.data ?? 0);
    const netHashrate = Number(net.data ?? 0);
    const share = netHashrate > 0 ? myHashrate / netHashrate : 0;
    const myEntries = (entries.data ?? []) as Array<{
      day: string;
      amount_usd: number;
      amount_gram: number;
    }>;

    // Estimated APY: average daily USD payout per 100 points (= $1 invested).
    const avgDailyUsd =
      myEntries.length > 0
        ? myEntries.reduce((s, e) => s + Number(e.amount_usd || 0), 0) / myEntries.length
        : 0;
    const investedUsd = myHashrate / 100;
    const apy = investedUsd > 0 ? (avgDailyUsd / investedUsd) * 365 * 100 : 0;

    // Projected payout for today: wallet balance x payout ratio, split by hashrate.
    const configuredRatio = Number(
      (ratioRow.data as { value?: { value?: number } } | null)?.value?.value ?? 0.65,
    );
    void revToday;
    void deferred;

    // Mirror run_daily_payout() exactly: the pool is the full wallet balance
    // minus the house cut (1 - payout_ratio).
    const poolRows = (pools.data ?? []) as Array<{
      day: string;
      pool_usd: number;
      total_hashrate: number;
      status?: string;
      payout_ratio?: number;
      solvency_ratio?: number | null;
      treasury_ton?: number | null;
    }>;

    const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
    const gramPrice = await fetchTonPriceUsdt().catch(() => 0);

    // Live wallet balance (falls back to the last recorded treasury snapshot).
    let treasuryTon = Number(poolRows[0]?.treasury_ton ?? 0);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(
        "https://tonapi.io/v2/accounts/UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn",
        { headers: { accept: "application/json" }, signal: controller.signal },
      );
      clearTimeout(timeout);
      if (res.ok) {
        const j = (await res.json()) as { balance?: string | number };
        const live = Number(j?.balance ?? 0) / 1e9;
        if (live > 0) treasuryTon = live;
      }
    } catch {
      /* keep snapshot fallback */
    }

    const treasuryUsd = Math.max(treasuryTon, 0) * (gramPrice > 0 ? gramPrice : 0);
    let estPoolUsd = Math.max(treasuryUsd * configuredRatio, 0);

    // Today's pool row (if the payout already ran) is the source of truth.
    const todayPool = poolRows.find((p) => p.day === today);
    let estDailyUsd: number;
    if (todayPool) {
      const totalHash = Number(todayPool.total_hashrate || 0);
      const realShare = totalHash > 0 ? Math.min(myHashrate / totalHash, 1) : 0;
      estPoolUsd = Number(todayPool.pool_usd || 0);
      estDailyUsd = realShare * estPoolUsd;
    } else {
      estDailyUsd = share * estPoolUsd;
    }

    // If a payout entry already exists for today, that IS the real amount.
    const todayEntry = myEntries.find((e) => e.day === today);
    if (todayEntry) {
      estDailyUsd = Number(todayEntry.amount_usd || 0);
    }
    const estDailyGram = todayEntry
      ? Number(todayEntry.amount_gram || 0)
      : gramPrice > 0
        ? estDailyUsd / gramPrice
        : 0;



    return {
      enabled: Boolean(
        (flag.data as { value?: { enabled?: boolean } } | null)?.value?.enabled,
      ),
      myHashrate,
      netHashrate,
      share,
      lastPayout: myEntries[0] ?? null,
      history: myEntries,
      pools: pools.data ?? [],
      apy,
      gramPrice,
      estPoolUsd,
      estDailyUsd,
      estDailyGram,
      estMonthlyGram: estDailyGram * 30,
      pendingGram,
      pendingDays: pendingRows.length,
      nextPayoutAt: `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`,
    };
  });

/** Claim all unclaimed daily payouts into the user's balance. */
export const claimPayouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertNotBanned(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("claim_payouts" as never, {
      _user_id: context.userId,
    } as never);
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { gained: number; days: number; new_balance: number }
      | null;
    const gained = Number(row?.gained ?? 0);
    if (gained <= 0) throw new Error("Nothing to collect yet");
    return {
      gained,
      days: Number(row?.days ?? 0),
      newBalance: Number(row?.new_balance ?? 0),
    };
  });


export const adminEconomyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const today = new Date().toISOString().slice(0, 10);
    const [flag, ratio, revToday, revAll, pools, net, balances, treasury, deferred] = await Promise.all([
      supabaseAdmin.from("app_settings").select("value").eq("key", "economy_v2").maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", "payout_ratio").maybeSingle(),
      supabaseAdmin
        .from("revenue_events")
        .select("source, amount_usd")
        .gte("occurred_at", `${today}T00:00:00Z`),
      supabaseAdmin
        .from("revenue_events")
        .select("id, source, amount_usd, occurred_at, note")
        .order("occurred_at", { ascending: false })
        .limit(30),
      supabaseAdmin
        .from("payout_pool_daily")
        .select("*")
        .order("day", { ascending: false })
        .limit(14),
      supabaseAdmin.rpc("network_active_hashrate"),
      supabaseAdmin.from("profiles").select("balance"),
      supabaseAdmin
        .from("treasury_ledger")
        .select("direction, amount_usd")
        .limit(2000),
      supabaseAdmin
        .from("deferred_revenue")
        .select("daily_usd")
        .lte("starts_on", today)
        .gte("ends_on", today)
        .limit(5000),
    ]);

    const todayRows = (revToday.data ?? []) as Array<{ source: string; amount_usd: number }>;
    const bySource: Record<string, number> = {};
    for (const r of todayRows) {
      bySource[r.source] = (bySource[r.source] ?? 0) + Number(r.amount_usd || 0);
    }
    const debtGram = ((balances.data ?? []) as Array<{ balance: number }>).reduce(
      (s, r) => s + Number(r.balance || 0),
      0,
    );
    const ledger = (treasury.data ?? []) as Array<{ direction: string; amount_usd: number }>;
    const reserveUsd = ledger.reduce(
      (s, r) => s + (r.direction === "in" ? 1 : -1) * Number(r.amount_usd || 0),
      0,
    );

    const deferredDaily = ((deferred.data ?? []) as Array<{ daily_usd: number }>).reduce(
      (s, r) => s + Number(r.daily_usd || 0),
      0,
    );

    return {
      enabled: Boolean((flag.data as { value?: { enabled?: boolean } } | null)?.value?.enabled),
      deferredDaily,
      payoutRatio: Number(
        (ratio.data as { value?: { value?: number } } | null)?.value?.value ?? 0.65,
      ),
      revenueToday:
        todayRows.reduce((s, r) => s + Number(r.amount_usd || 0), 0) + deferredDaily,
      revenueBySource: bySource,
      recentRevenue: revAll.data ?? [],
      pools: pools.data ?? [],
      networkHashrate: Number(net.data ?? 0),
      debtGram,
      reserveUsd,
    };
  });

export const adminAddRevenue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { source: string; amountUsd: number; note?: string }) =>
    z
      .object({
        source: z.string().min(2).max(40),
        amountUsd: z.number(),
        note: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const { error } = await supabaseAdmin.rpc("add_revenue_event", {
      _source: data.source,
      _amount_usd: data.amountUsd,
      _note: data.note ?? undefined,
      _ref: undefined,
      _created_by: context.userId,
    });
    if (error) throw error;
    return { ok: true };
  });

export const adminSetEconomySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled?: boolean; payoutRatio?: number }) =>
    z
      .object({
        enabled: z.boolean().optional(),
        payoutRatio: z.number().min(0).max(1).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    if (typeof data.enabled === "boolean") {
      await supabaseAdmin
        .from("app_settings")
        .upsert({ key: "economy_v2", value: { enabled: data.enabled } }, { onConflict: "key" });
    }
    if (typeof data.payoutRatio === "number") {
      await supabaseAdmin
        .from("app_settings")
        .upsert({ key: "payout_ratio", value: { value: data.payoutRatio } }, { onConflict: "key" });
    }
    return { ok: true };
  });

/** Runs (or resumes) the payout for a given day. Admin-triggered. */
export const adminRunPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { day?: string }) => z.object({ day: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
    const price = await fetchTonPriceUsdt().catch(() => 0);

    let treasuryTon = 0;
    try {
      const res = await fetch(
        "https://tonapi.io/v2/accounts/UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn",
        { headers: { accept: "application/json" } },
      );
      if (res.ok) {
        const j = (await res.json()) as { balance?: string | number };
        treasuryTon = Number(j?.balance ?? 0) / 1e9;
      }
    } catch {
      treasuryTon = 0;
    }

    const day =
      data.day ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const out: Array<{ status: string; remaining: number } | null> = [];
    for (let i = 0; i < 20; i++) {
      const { data: r, error } = await supabaseAdmin.rpc("run_daily_payout", {
        _day: day,
        _gram_price: price > 0 ? price : 1,
        _treasury_ton: treasuryTon,
        _batch: 300,
      });
      if (error) throw error;
      const row = (Array.isArray(r) ? r[0] : r) as
        | { status: string; remaining: number }
        | undefined;
      out.push(row ?? null);
      if (!row || row.status === "done" || Number(row.remaining ?? 0) === 0) break;
    }
    return { ok: true, day, treasuryTon, gramPrice: price, rounds: out };
  });
