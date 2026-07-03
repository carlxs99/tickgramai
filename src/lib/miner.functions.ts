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

    const now = Date.now();
    const last = new Date(profile.last_collect_at as string).getTime();
    const seconds = Math.max(0, (now - last) / 1000);
    const perSecond = Number(profile.mining_rate) / 86400;
    const pending = perSecond * seconds;
    return { profile, pending, perSecond };
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
    const [tasks, done] = await Promise.all([
      supabase.from("tasks").select("*").eq("is_active", true).order("reward"),
      supabase.from("user_tasks").select("task_id").eq("user_id", userId).eq("completed_on", today),
    ]);
    if (tasks.error) throw tasks.error;
    const completed = new Set((done.data ?? []).map((r) => r.task_id));
    return (tasks.data ?? []).map((t) => ({ ...t, completed: completed.has(t.id) }));
  });

export const completeTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string }) => z.object({ taskId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: task, error: tErr } = await supabase
      .from("tasks").select("id,reward,is_active").eq("id", data.taskId).maybeSingle();
    if (tErr || !task?.is_active) throw new Error("Task not available");
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
    z.object({ amount: z.number().positive().min(100), address: z.string().min(10), memo: z.string().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase.from("profiles").select("balance").eq("user_id", userId).maybeSingle();
    if (!profile || Number(profile.balance) < data.amount) throw new Error("Insufficient balance");
    const fee = data.amount * 0.05;
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
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_top_miners", { _limit: 30 });
    if (error) throw error;
    return data ?? [];
  });

export const getFriends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("referrals").select("*").eq("referrer_id", context.userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });
