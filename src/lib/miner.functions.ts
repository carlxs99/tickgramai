import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// GET current user profile with accumulated (uncollected) income
export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) throw new Error("Profile not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    const now = Date.now();
    const last = new Date(profile.last_collect_at as string).getTime();
    const seconds = Math.max(0, (now - last) / 1000);
    const perSecond = Number(profile.mining_rate) / 86400;
    const pending = perSecond * seconds;
    return { profile, pending, perSecond, isAdmin: !!isAdmin };
  });

export const collectIncome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles").select("balance,mining_rate,last_collect_at").eq("user_id", userId).maybeSingle();
    if (!profile) throw new Error("No profile");
    const now = new Date();
    const seconds = Math.max(0, (now.getTime() - new Date(profile.last_collect_at as string).getTime()) / 1000);
    const gained = (Number(profile.mining_rate) / 86400) * seconds;
    const newBalance = Number(profile.balance) + gained;
    const { error } = await supabase
      .from("profiles")
      .update({ balance: newBalance, last_collect_at: now.toISOString() })
      .eq("user_id", userId);
    if (error) throw error;
    return { gained, balance: newBalance };
  });

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const today = new Date().toISOString().slice(0, 10);
    const [tasks, done, prof] = await Promise.all([
      supabase.from("tasks").select("*").eq("is_active", true).order("reward"),
      supabase.from("user_tasks").select("task_id").eq("user_id", userId).eq("completed_on", today),
      supabase.from("profiles").select("deposit_total").eq("user_id", userId).maybeSingle(),
    ]);
    if (tasks.error) throw tasks.error;
    const completed = new Set((done.data ?? []).map((r) => r.task_id));
    const depositTotal = Number(prof.data?.deposit_total ?? 0);
    // Hide tasks the user has not unlocked yet (e.g. "Deposit TON" until a deposit exists).
    return (tasks.data ?? [])
      .filter((t) => depositTotal >= Number(t.min_deposit ?? 0))
      .map((t) => ({ ...t, completed: completed.has(t.id) }));
  });

export const completeTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string }) => z.object({ taskId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: task, error: tErr } = await supabase
      .from("tasks").select("id,reward,is_active,kind,target_chat,min_deposit").eq("id", data.taskId).maybeSingle();
    if (tErr || !task?.is_active) throw new Error("Task not available");

    // Deposit-gated tasks: require the user's cumulative deposits to reach min_deposit.
    if (Number(task.min_deposit ?? 0) > 0) {
      const { data: prof } = await supabase
        .from("profiles").select("deposit_total").eq("user_id", userId).maybeSingle();
      if (Number(prof?.deposit_total ?? 0) < Number(task.min_deposit)) {
        throw new Error("Debes hacer un depósito primero para desbloquear esta tarea");
      }
    }



    // Channel/group tasks: verify the user is subscribed via getChatMember.
    if ((task.kind === "channel" || task.kind === "group") && task.target_chat) {
      const { data: profile } = await supabase
        .from("profiles").select("telegram_id").eq("user_id", userId).maybeSingle();
      const tgId = profile?.telegram_id;
      if (!tgId) throw new Error("Cuenta de Telegram no vinculada");

      const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
      const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
      if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) throw new Error("Telegram no configurado");

      const resp = await fetch("https://connector-gateway.lovable.dev/telegram/getChatMember", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": TELEGRAM_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chat_id: task.target_chat, user_id: tgId }),
      });
      const json: any = await resp.json().catch(() => ({}));
      if (!resp.ok || !json?.ok) {
        throw new Error(
          "No se pudo verificar la suscripción. Asegúrate de que el bot es admin del canal/grupo."
        );
      }
      const status = json.result?.status;
      const isMember = ["creator", "administrator", "member", "restricted"].includes(status);
      if (!isMember) throw new Error("Aún no estás suscrito al canal/grupo");
    }

    const today = new Date().toISOString().slice(0, 10);
    const { error: iErr } = await supabase.from("user_tasks").insert({
      user_id: userId, task_id: task.id, completed_on: today, reward: task.reward,
    });
    if (iErr) throw new Error("Already claimed today");
    const { data: profile } = await supabase.from("profiles").select("balance").eq("user_id", userId).maybeSingle();
    const newBalance = Number(profile?.balance ?? 0) + Number(task.reward);
    await supabase.from("profiles").update({ balance: newBalance }).eq("user_id", userId);
    return { reward: Number(task.reward), balance: newBalance };
  });

export const saveWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { address: string | null }) =>
    z.object({ address: z.string().min(10).max(80).nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("profiles").update({ wallet_address: data.address }).eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const submitDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amountTon: number; txHash?: string }) =>
    z.object({ amountTon: z.number().positive(), txHash: z.string().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // Daily ROI 3.3% in USDT value. Since 1 TON = 1 GRAM (same USD price),
    // 1 TON deposited yields 0.033 GRAM/day (= 3.3% USDT/day).
    const DAILY_ROI = 0.033;
    const gramPerDay = data.amountTon * DAILY_ROI;
    const { error } = await supabase.from("deposits").insert({
      user_id: userId, amount_ton: data.amountTon, gram_per_day: gramPerDay,
      tx_hash: data.txHash ?? null, status: "pending",
    });
    if (error) throw error;
    return { ok: true };
  });

export const listDeposits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("deposits").select("*").eq("user_id", context.userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const submitWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amount: number; address: string; memo?: string }) =>
    z.object({ amount: z.number().positive().min(1), address: z.string().min(10), memo: z.string().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase.from("profiles").select("balance").eq("user_id", userId).maybeSingle();
    if (!profile || Number(profile.balance) < data.amount) throw new Error("Insufficient balance");
    const fee = data.amount * 0.10;
    const net = data.amount - fee;
    const { error } = await supabase.from("withdrawals").insert({
      user_id: userId, amount: data.amount, address: data.address, memo: data.memo ?? null,
      fee, net_amount: net, status: "pending",
    });
    if (error) throw error;
    await supabase.from("profiles").update({ balance: Number(profile.balance) - data.amount }).eq("user_id", userId);
    return { ok: true, fee, net };
  });

export const listWithdrawals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("withdrawals").select("*").eq("user_id", context.userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getTopMiners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    // Use service-role client to bypass RLS for the public leaderboard,
    // exposing only the safe columns. Authenticated users cannot call the
    // underlying SECURITY DEFINER function directly.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("get_top_miners", { _limit: 30 });
    if (error) throw error;
    return data ?? [];
  });

export const getFriends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: refs, error } = await context.supabase
      .from("referrals").select("*").eq("referrer_id", context.userId).order("created_at", { ascending: false });
    if (error) throw error;
    const rows = refs ?? [];
    if (rows.length === 0) return [];
    const ids = rows.map((r: any) => r.referred_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("user_id, username, first_name, last_name, avatar_url")
      .in("user_id", ids);
    const map = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
    return rows.map((r: any) => ({
      ...r,
      profile: map.get(r.referred_id) ?? null,
    }));
  });
