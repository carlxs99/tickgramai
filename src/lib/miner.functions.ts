import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchTonPriceUsdt } from "@/lib/prices.functions";


// Mining rate is stored in USDT/day on profiles.mining_rate_usd (source of truth).
// 1 TON deposited at price P → P * 0.033 USDT/day (deterministic 3.3% daily in USD).
// GRAM earned = usd_per_day * seconds / (86400 * current_ton_price), so the user's
// GRAM yield floats with the TON price while the USD yield stays fixed.

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

    const rateUsdPerDay = Number((profile as any).mining_rate_usd ?? 0);
    const tonPrice = (await fetchTonPriceUsdt()) || 1;
    const rateGramPerDay = rateUsdPerDay / tonPrice;
    const now = Date.now();
    const last = new Date(profile.last_collect_at as string).getTime();
    const seconds = Math.max(0, (now - last) / 1000);
    const perSecond = rateGramPerDay / 86400;
    const pending = perSecond * seconds;
    return {
      profile: {
        ...profile,
        mining_rate: rateGramPerDay,
        mining_rate_usd: rateUsdPerDay,
      },
      pending,
      perSecond,
      tonPrice,
      isAdmin: !!isAdmin,
    };
  });

export const collectIncome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    // Fetch current TON price server-side (never trust the client for economic inputs).
    const tonPrice = await fetchTonPriceUsdt();
    if (!(tonPrice > 0)) throw new Error("Precio TON no disponible");

    // Atomic collect via SECURITY DEFINER RPC (row-level FOR UPDATE lock).
    // Converts USD/day → GRAM at the current TON price.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .rpc("atomic_collect_income_usd" as never, { _user_id: userId, _ton_price: tonPrice } as never);
    if (error) throw error;
    const row: any = Array.isArray(data) ? data[0] : data;
    return { gained: Number(row?.gained ?? 0), balance: Number(row?.new_balance ?? 0) };
  });





export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const today = new Date().toISOString().slice(0, 10);
    const [tasks, doneToday, doneEver, prof] = await Promise.all([
      supabase.from("tasks").select("*").eq("is_active", true).order("reward"),
      supabase.from("user_tasks").select("task_id").eq("user_id", userId).eq("completed_on", today),
      supabase.from("user_tasks").select("task_id").eq("user_id", userId),
      supabase.from("profiles").select("deposit_total").eq("user_id", userId).maybeSingle(),
    ]);
    if (tasks.error) throw tasks.error;
    const completedToday = new Set((doneToday.data ?? []).map((r) => r.task_id));
    const completedEver = new Set((doneEver.data ?? []).map((r) => r.task_id));
    const depositTotal = Number(prof.data?.deposit_total ?? 0);
    // Hide tasks the user has not unlocked yet (e.g. "Deposit TON" until a deposit exists).
    return (tasks.data ?? [])
      .filter((t) => depositTotal >= Number(t.min_deposit ?? 0))
      .map((t) => ({
        ...t,
        completed: t.kind === "daily" ? completedToday.has(t.id) : completedEver.has(t.id),
      }));
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

    // Completions go through a SECURITY DEFINER RPC that atomically validates
    // task state, deposit gating, and (for non-daily kinds) rejects duplicates.
    const { supabaseAdmin: adminForTask } = await import("@/integrations/supabase/client.server");
    const { error: iErr } = await adminForTask
      .rpc("complete_task" as never, { _user_id: userId, _task_id: task.id } as never);
    if (iErr) throw new Error(iErr.message || "Already claimed");


    // Admin-defined task rewards act as "capital": mining adds 3.3% of the reward
    // per day (matching the deposit formula), NOT the full reward as daily rate.
    // Partner tasks credit the balance directly (see completePartnerTask).
    const rewardCapitalUsd = Number(task.reward);
    const dailyAddUsd = rewardCapitalUsd * 0.033;
    const tonPrice = (await fetchTonPriceUsdt()) || 1;
    const dailyAddGram = dailyAddUsd / tonPrice;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Atomic add — prevents lost-update races with concurrent reinvest/deposit crediting.
    const { data: rpcRow, error: uErr } = await supabaseAdmin
      .rpc("atomic_add_mining_rate" as never, {
        _user_id: userId,
        _add_rate_usd: dailyAddUsd,
        _add_rate_gram: dailyAddGram,
        _add_deposit_ton: 0,
      } as never);
    if (uErr) throw uErr;
    const rpc: any = Array.isArray(rpcRow) ? rpcRow[0] : rpcRow;
    const { data: cur } = await supabaseAdmin
      .from("profiles").select("balance").eq("user_id", userId).maybeSingle();
    return {
      reward: dailyAddUsd,
      rewardUsd: dailyAddUsd,
      rewardCapitalUsd,
      balance: Number((cur as any)?.balance ?? 0),
      miningRateUsd: Number(rpc?.new_rate_usd ?? 0),
    };
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
    const { userId } = context;
    // This endpoint records the user's INTENT to deposit. It does NOT credit
    // mining_rate — real credit comes only from on-chain events processed by
    // /api/public/verify-deposits after the TON transaction confirms.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Rate limit: reject if the user already has 5 pending deposit intents
    // in the last hour, to prevent flooding the deposits table.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("deposits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending")
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= 5) {
      throw new Error("Demasiadas solicitudes de depósito pendientes. Espera unos minutos.");
    }
    const { error } = await supabaseAdmin.from("deposits").insert({
      user_id: userId, amount_ton: data.amountTon, gram_per_day: 0,
      tx_hash: null, status: "pending",
    });
    if (error) throw error;
    return { ok: true };
  });


// Reinvest GRAM from balance into mining_rate. Same ROI as an on-chain
// deposit (3.3% daily), atomically debits balance and increases mining_rate.
// Minimum reinvest amount is 0.1 GRAM.
export const reinvestBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amount: number }) =>
    z.object({ amount: z.number().positive().min(0.1) }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Atomic decrement first — returns NULL if balance is insufficient.
    const { data: newBalance, error: dErr } = await supabaseAdmin
      .rpc("atomic_decrement_balance" as never, { _user_id: userId, _amount: data.amount } as never);
    if (dErr) throw dErr;
    if (newBalance === null || newBalance === undefined) {
      throw new Error("Insufficient balance");
    }
    // 3.3% daily denominated in USDT. Snapshot TON price to lock the USD value in.
    const tonPrice = (await fetchTonPriceUsdt()) || 1;
    const usdPerDay = data.amount * tonPrice * 0.033;
    const gramPerDay = data.amount * 0.033; // snapshot for deposit history
    // Atomic increment of mining_rate_usd / mining_rate / deposit_total
    // — no lost-update race with concurrent deposit crediting.
    const { error: uErr } = await supabaseAdmin
      .rpc("atomic_add_mining_rate" as never, {
        _user_id: userId,
        _add_rate_usd: usdPerDay,
        _add_rate_gram: gramPerDay,
        _add_deposit_ton: data.amount,
      } as never);
    if (uErr) {
      await supabaseAdmin.rpc("atomic_add_balance" as never, { _user_id: userId, _amount: data.amount } as never);
      throw uErr;
    }

    await supabaseAdmin.from("deposits").insert({
      user_id: userId,
      amount_ton: data.amount,
      gram_per_day: gramPerDay,
      tx_hash: null,
      status: "confirmed",
    });
    return { ok: true, balance: Number(newBalance), gramPerDay, usdPerDay };
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
    z.object({ amount: z.number().positive(), address: z.string().min(10), memo: z.string().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    if (!/^[A-Za-z0-9_\-:+/=]{10,80}$/.test(data.address)) {
      throw new Error("Invalid address format");
    }
    // Minimum withdrawal is $3 worth of GRAM at current TON price.
    const tonPrice = await fetchTonPriceUsdt();
    if (!(tonPrice > 0)) throw new Error("Precio TON no disponible");
    const minGram = 3 / tonPrice;
    if (data.amount < minGram) {
      throw new Error(`Minimum withdrawal is ${minGram.toFixed(4)} GRAM`);
    }
    // 5% network fee (must match UI copy in withdraw.subtitle / withdraw.fee_label).
    const fee = data.amount * 0.05;
    const net = data.amount - fee;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Atomic balance decrement: returns the new balance if the user had enough
    // funds, or NULL otherwise. Prevents concurrent withdrawals from
    // double-spending against the same balance.
    const { data: newBalance, error: dErr } = await supabaseAdmin
      .rpc("atomic_decrement_balance" as never, { _user_id: userId, _amount: data.amount } as never);
    if (dErr) throw dErr;
    if (newBalance === null || newBalance === undefined) {
      throw new Error("Insufficient balance");
    }
    const { error } = await supabaseAdmin.from("withdrawals").insert({
      user_id: userId, amount: data.amount, address: data.address, memo: data.memo ?? null,
      fee, net_amount: net, status: "pending",
    });
    if (error) {
      // Refund on insert failure so the user is not charged for a non-existent withdrawal.
      await supabaseAdmin.rpc("atomic_add_balance" as never, { _user_id: userId, _amount: data.amount } as never);
      throw error;
    }
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
    const { data, error } = await supabaseAdmin.rpc("get_top_miners", { _limit: 100 });
    if (error) throw error;
    return data ?? [];
  });

// Returns the current user's global rank based on mining_rate_usd.
// Admins are excluded from the ranking to keep the leaderboard focused on users.
export const getMyRank = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: me, error: meErr } = await supabaseAdmin
      .from("profiles")
      .select("mining_rate_usd")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (meErr) throw meErr;
    const myRate = Number((me as any)?.mining_rate_usd ?? 0);
    const { count, error } = await supabaseAdmin
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .gt("mining_rate_usd", myRate)
      .not("user_id", "in", (
        supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin")
      ) as any);
    if (error) throw error;
    return { rank: (count ?? 0) + 1, rate_usd: myRate };
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

export const getReferralStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_referral_stats" as never, { _user_id: context.userId } as never);
    if (error) throw error;
    return (data ?? {}) as {
      inviter: {
        user_id: string;
        username: string | null;
        first_name: string | null;
        last_name: string | null;
        avatar_url: string | null;
      } | null;
      level1: number;
      level2: number;
      level3: number;
      total_referrals: number;
      total_earned: number;
      refback_paid: number;
      refback_rate: number;
    };
  });



// ============= Partner Tasks =============
// Users create promoted tasks (channel/group/bot/link) and pay via TON to
// promote them. Cost: 0.001 TON per click, minimum 250 clicks (0.25 TON).
// Reward per click: 0.001 GRAM. Auto-completes when target_clicks is reached.

const PARTNER_COST_PER_CLICK = 0.001; // TON
const PARTNER_MIN_CLICKS = 250;

// Public list: active partner tasks the user has not completed and does not own.
export const listPartnerTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc(
      "list_active_partner_tasks" as never,
      { _user_id: userId } as never,
    );
    if (error) throw error;
    return (data ?? []) as any[];
  });


// Owner list: my partner tasks (any state).
export const listMyPartnerTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("partner_tasks")
      .select("*")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

// Create a partner task in pending_payment state. Returns the memo the user
// must include in their TON payment; verify-deposits activates the task
// once the on-chain payment matching cost_ton + memo is detected.
export const createPartnerTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title: string; link: string; kind: string; targetClicks: number }) =>
    z.object({
      title: z.string().trim().min(2).max(80),
      link: z.string().trim().url().max(300),
      kind: z.enum(["link", "channel", "group", "bot"]),
      targetClicks: z.number().int().min(PARTNER_MIN_CLICKS).max(1_000_000),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const costTon = Number((data.targetClicks * PARTNER_COST_PER_CLICK).toFixed(6));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: memoRow, error: mErr } = await supabaseAdmin
      .rpc("generate_partner_memo" as never);
    if (mErr) throw mErr;
    const memo = String(memoRow);

    const { data: inserted, error: iErr } = await supabaseAdmin
      .from("partner_tasks")
      .insert({
        owner_id: userId,
        title: data.title,
        link: data.link,
        kind: data.kind,
        target_clicks: data.targetClicks,
        reward_per_click: 0.001,
        cost_ton: costTon,
        memo_tag: memo,
        status: "pending_payment",
      })
      .select()
      .single();
    if (iErr) throw iErr;
    return inserted;
  });

// Called after the user visits the partner's link. Atomically records the
// completion, credits +0.001 GRAM, and auto-completes the task when target
// is reached. Enforces one completion per user and prevents owner self-claim.
export const completePartnerTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partnerTaskId: string }) =>
    z.object({ partnerTaskId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .rpc("complete_partner_task" as never, {
        _user_id: userId,
        _partner_task_id: data.partnerTaskId,
      } as never);
    if (error) throw error;
    const r: any = Array.isArray(row) ? row[0] : row;
    return {
      reward: Number(r?.reward ?? 0),
      balance: Number(r?.new_balance ?? 0),
      remainingClicks: Number(r?.remaining_clicks ?? 0),
    };
  });

// Cancel a partner task that is still pending_payment (never paid).
export const cancelPartnerTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partnerTaskId: string }) =>
    z.object({ partnerTaskId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("partner_tasks")
      .update({ status: "cancelled" })
      .eq("id", data.partnerTaskId)
      .eq("owner_id", context.userId)
      .eq("status", "pending_payment");
    if (error) throw error;
    return { ok: true };
  });

