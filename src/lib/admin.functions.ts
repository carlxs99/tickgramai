import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Forbidden: admin only");
}

export const adminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      usersCount,
      depositsAgg,
      withdrawalsAgg,
      tasksCount,
      completedToday,
      miningSum,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("deposits").select("amount_ton, status"),
      supabaseAdmin.from("withdrawals").select("amount, net_amount, status"),
      supabaseAdmin.from("tasks").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("user_tasks").select("id", { count: "exact", head: true })
        .eq("completed_on", new Date().toISOString().slice(0, 10)),
      supabaseAdmin.from("profiles").select("mining_rate, balance, deposit_total"),
    ]);

    const dep = depositsAgg.data ?? [];
    const wd = withdrawalsAgg.data ?? [];
    const ms = miningSum.data ?? [];

    return {
      users: usersCount.count ?? 0,
      tasks: tasksCount.count ?? 0,
      completedToday: completedToday.count ?? 0,
      deposits: {
        count: dep.length,
        totalTon: dep.reduce((s, r: any) => s + Number(r.amount_ton || 0), 0),
        confirmed: dep.filter((r: any) => r.status === "confirmed").length,
      },
      withdrawals: {
        count: wd.length,
        totalGram: wd.reduce((s, r: any) => s + Number(r.amount || 0), 0),
        pending: wd.filter((r: any) => r.status === "pending").length,
        paid: wd.filter((r: any) => r.status === "paid").length,
      },
      totals: {
        miningRate: ms.reduce((s, r: any) => s + Number(r.mining_rate || 0), 0),
        balance: ms.reduce((s, r: any) => s + Number(r.balance || 0), 0),
        depositTotal: ms.reduce((s, r: any) => s + Number(r.deposit_total || 0), 0),
      },
    };
  });

export const adminListTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("tasks").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

const TaskInput = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(2).max(64),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
  reward: z.number().nonnegative(),
  kind: z.enum(["daily", "once", "channel", "group"]),
  min_deposit: z.number().nonnegative().default(0),
  link: z.string().url().optional().nullable(),
  target_chat: z.string().max(200).optional().nullable(),
  is_active: z.boolean().default(true),
});

export const adminSaveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof TaskInput>) => TaskInput.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...fields } = data;
    if ((fields.kind === "channel" || fields.kind === "group") && !fields.target_chat) {
      throw new Error("target_chat es obligatorio para tareas de canal/grupo");
    }
    if (id) {
      const { error } = await supabaseAdmin.from("tasks").update(fields).eq("id", id);
      if (error) throw error;
      return { ok: true, id };
    }
    const { data: inserted, error } = await supabaseAdmin
      .from("tasks").insert(fields).select("id").maybeSingle();
    if (error) throw error;
    return { ok: true, id: inserted?.id };
  });

export const adminDeleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("tasks").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// List all users, ordered by mining rate (USD) desc. Optional search by username / first_name / telegram id.
export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; limit?: number } | undefined) =>
    z.object({ search: z.string().max(100).optional(), limit: z.number().int().min(1).max(500).optional() }).partial().parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("profiles")
      .select("user_id, username, first_name, last_name, avatar_url, telegram_id, balance, mining_rate, mining_rate_usd, deposit_total, created_at")
      .order("mining_rate_usd", { ascending: false })
      .order("balance", { ascending: false })
      .limit(data.limit ?? 200);
    const s = data.search?.trim();
    if (s) {
      // Strip every character PostgREST treats specially inside .or() filter
      // strings so a malicious admin search can't break out of the ilike
      // pattern into another filter expression.
      const esc = s.replace(/[%,.()"'\\*:]/g, "").slice(0, 60);
      const asNum = Number(s);
      if (esc.length > 0) {
        if (Number.isFinite(asNum) && /^\d+$/.test(s)) {
          q = q.or(`username.ilike.%${esc}%,first_name.ilike.%${esc}%,telegram_id.eq.${asNum}`);
        } else {
          q = q.or(`username.ilike.%${esc}%,first_name.ilike.%${esc}%,last_name.ilike.%${esc}%`);
        }
      }
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

// Full details for a single user: profile + deposits + withdrawals + referrals + completed tasks count.
export const adminUserDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [profileRes, depositsRes, withdrawalsRes, refsRes, tasksDoneRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("user_id", data.user_id).maybeSingle(),
      supabaseAdmin.from("deposits").select("id, amount_ton, gram_per_day, status, tx_hash, created_at")
        .eq("user_id", data.user_id).order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("withdrawals").select("id, amount, net_amount, fee, status, address, tx_hash, created_at, paid_at")
        .eq("user_id", data.user_id).order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("referrals").select("referred_id, bonus_earned, created_at")
        .eq("referrer_id", data.user_id).order("created_at", { ascending: false }).limit(100),
      supabaseAdmin.from("user_tasks").select("id", { count: "exact", head: true }).eq("user_id", data.user_id),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (!profileRes.data) throw new Error("Usuario no encontrado");

    // Enrich referrals with the referred user's profile info.
    const refs = refsRes.data ?? [];
    let referredProfiles: any[] = [];
    if (refs.length) {
      const ids = refs.map((r: any) => r.referred_id);
      const { data: rp } = await supabaseAdmin
        .from("profiles")
        .select("user_id, username, first_name, avatar_url, mining_rate_usd, deposit_total")
        .in("user_id", ids);
      referredProfiles = rp ?? [];
    }
    const referrals = refs.map((r: any) => {
      const p = referredProfiles.find((x) => x.user_id === r.referred_id);
      return {
        referred_id: r.referred_id,
        bonus_earned: Number(r.bonus_earned ?? 0),
        created_at: r.created_at,
        username: p?.username ?? null,
        first_name: p?.first_name ?? null,
        avatar_url: p?.avatar_url ?? null,
        mining_rate_usd: Number(p?.mining_rate_usd ?? 0),
        deposit_total: Number(p?.deposit_total ?? 0),
      };
    });

    const deposits = depositsRes.data ?? [];
    const withdrawals = withdrawalsRes.data ?? [];

    return {
      profile: profileRes.data,
      deposits,
      withdrawals,
      referrals,
      totals: {
        depositsCount: deposits.length,
        depositsConfirmed: deposits.filter((d: any) => d.status === "confirmed").length,
        depositsTonConfirmed: deposits.filter((d: any) => d.status === "confirmed")
          .reduce((s: number, d: any) => s + Number(d.amount_ton || 0), 0),
        withdrawalsCount: withdrawals.length,
        withdrawalsPaid: withdrawals.filter((w: any) => w.status === "paid").length,
        withdrawalsGramPaid: withdrawals.filter((w: any) => w.status === "paid")
          .reduce((s: number, w: any) => s + Number(w.amount || 0), 0),
        referralsCount: referrals.length,
        referralBonusTotal: referrals.reduce((s, r) => s + r.bonus_earned, 0),
        tasksCompleted: tasksDoneRes.count ?? 0,
      },
    };
  });

