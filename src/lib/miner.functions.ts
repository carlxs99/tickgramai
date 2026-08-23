import { assertNotBanned } from "@/lib/ban-guard";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PARTNER_COST_PER_CLICK, PARTNER_MIN_CLICKS } from "@/lib/partner-config";


// Economy v2: earnings come from the dynamic daily pool (hashrate share),
// paid automatically at 00:00 UTC. The legacy mining_rate_* columns are kept
// at zero and only remain for historical/admin reporting.

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

    let isAdmin = false;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      isAdmin = !!data;
    } catch {
      isAdmin = false;
    }

    const rateUsdPerDay = Number((profile as any).mining_rate_usd ?? 0);
    let tonPrice = 1;
    try {
      const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
      tonPrice = (await fetchTonPriceUsdt()) || 1;
    } catch {
      tonPrice = 1;
    }

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
    await assertNotBanned(context.supabase, context.userId);
    const { userId } = context;
    // Fetch current TON price server-side (never trust the client for economic inputs).
    const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
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
    await assertNotBanned(context.supabase, context.userId);
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


    // Economy v2: the task reward (denominated in GRAM capital) is converted
    // into hashrate points (100 pts per USD, 180 days). No legacy fixed ROI.
    const rewardCapitalGram = Number(task.reward);
    const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
    const tonPrice = (await fetchTonPriceUsdt()) || 1;
    const dailyAddGram = 0;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("grant_hashrate" as never, {
      _user_id: userId,
      _points: rewardCapitalGram * tonPrice * 100,
      _source: "task",
      _source_ref_id: null,
      _days: 180,
    } as never);
    const { data: cur } = await supabaseAdmin
      .from("profiles").select("balance").eq("user_id", userId).maybeSingle();
    return {
      reward: dailyAddGram,
      rewardGram: dailyAddGram,
      rewardCapitalGram,
      balance: Number((cur as any)?.balance ?? 0),
      hashratePoints: rewardCapitalGram * tonPrice * 100,
    };
  });



export const saveWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { address: string | null }) =>
    z.object({
      address: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_\-:+/=]{10,80}$/, "Invalid address format")
        .nullable(),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("profiles").update({ wallet_address: data.address }).eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const submitDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amountTon: number; txHash?: string }) =>
    z.object({
      amountTon: z.number().positive().min(0.1).max(100000),
      txHash: z.string().max(200).optional(),
    }).parse(d))
  .handler(async ({ context, data }) => {
    await assertNotBanned(context.supabase, context.userId);
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


// Reinvest GRAM from balance into hashrate (Economy v2): atomically debits
// balance and grants 100 points per USD for 180 days.
// Minimum reinvest amount is 0.1 GRAM.
export const reinvestBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amount: number }) =>
    z.object({ amount: z.number().positive().min(0.1) }).parse(d))
  .handler(async ({ context, data }) => {
    await assertNotBanned(context.supabase, context.userId);
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Atomic decrement first — returns NULL if balance is insufficient.
    const { data: newBalance, error: dErr } = await supabaseAdmin
      .rpc("atomic_decrement_balance" as never, { _user_id: userId, _amount: data.amount } as never);
    if (dErr) throw dErr;
    if (newBalance === null || newBalance === undefined) {
      throw new Error("Insufficient balance");
    }
    const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
    const tonPrice = (await fetchTonPriceUsdt()) || 1;
    const usdPerDay = 0;
    const gramPerDay = 0;
    // Atomic increment of deposit_total only (no legacy ROI in Economy v2).
    const { error: uErr } = await supabaseAdmin
      .rpc("atomic_add_mining_rate" as never, {
        _user_id: userId,
        _add_rate_usd: 0,
        _add_rate_gram: 0,
        _add_deposit_ton: data.amount,
      } as never);
    if (uErr) {
      await supabaseAdmin.rpc("atomic_add_balance" as never, { _user_id: userId, _amount: data.amount } as never);
      throw uErr;
    }

    const { data: reinvestDeposit } = await supabaseAdmin.from("deposits").insert({
      user_id: userId,
      amount_ton: data.amount,
      gram_per_day: gramPerDay,
      tx_hash: null,
      status: "confirmed",
    } as never).select("id").maybeSingle();

    // Economy v2: reinvesting converts balance into real mining power.
    // Without this grant the user would simply lose the reinvested balance.
    await supabaseAdmin.rpc("grant_hashrate" as never, {
      _user_id: userId,
      _points: data.amount * tonPrice * 100,
      _source: "reinvest",
      _source_ref_id: (reinvestDeposit as any)?.id ?? null,
      _days: 180,
    } as never);
    // Reinvesting burns a balance liability, so it is real recognised value
    // for the pool — amortised over the same 180-day window as the hashrate.
    await supabaseAdmin.rpc("add_deferred_revenue" as never, {
      _source: "reinvest",
      _amount_usd: data.amount * tonPrice,
      _ref: (reinvestDeposit as any)?.id ?? null,
      _days: 180,
    } as never);
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
    z.object({
      amount: z.number().min(1).max(1_000_000),
      address: z.string().trim().min(10).max(80),
      memo: z.string().trim().max(200).optional(),
    }).parse(d))
  .handler(async ({ context, data }) => {
    await assertNotBanned(context.supabase, context.userId);
    const { userId } = context;
    if (!/^[A-Za-z0-9_\-:+/=]{10,80}$/.test(data.address)) {
      throw new Error("Invalid address format");
    }
    // Minimum withdrawal is 1 GRAM. Rate limiting is one request per 24h and
    // is enforced inside create_withdrawal_atomic (race-safe, server-side).

    // 5% network fee (must match UI copy in withdraw.subtitle / withdraw.fee_label).
    const fee = data.amount * 0.05;
    const net = data.amount - fee;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Debit and audit-row creation happen in one database transaction. A
    // timeout can therefore never charge the user without recording the job.
    const { data: created, error } = await supabaseAdmin.rpc("create_withdrawal_atomic" as never, {
      _user_id: userId,
      _amount: data.amount,
      _address: data.address,
      _memo: data.memo ?? null,
      _fee: fee,
      _net_amount: net,
    } as never);
    if (error) {
      if (/insufficient balance/i.test(error.message)) throw new Error("Insufficient balance");
      const limit = /daily withdrawal limit reached:(\S+)/i.exec(error.message);
      if (limit) throw new Error(`DAILY_LIMIT:${limit[1]}`);
      throw error;
    }

    const createdRow: any = Array.isArray(created) ? created[0] : created;
    if (!createdRow?.withdrawal_id) throw new Error("Withdrawal could not be recorded");
    return { ok: true, fee, net, withdrawalId: createdRow.withdrawal_id };
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isEconomyV2, topMinersByHashrate, estimatedPoolToday } = await import(
      "@/lib/leaderboard.server"
    );

    if (await isEconomyV2()) {
      const [miners, pool] = await Promise.all([topMinersByHashrate(100), estimatedPoolToday()]);
      const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
      const price = await fetchTonPriceUsdt().catch(() => 0);
      return miners.map((m) => {
        const share = pool.netHashrate > 0 ? m.hashrate / pool.netHashrate : 0;
        const estUsd = share * pool.poolUsd;
        return {
          username: m.username,
          first_name: m.first_name,
          avatar_url: m.avatar_url,
          telegram_id: m.telegram_id,
          hashrate: m.hashrate,
          est_daily_usd: estUsd,
          est_daily_gram: price > 0 ? estUsd / price : 0,
          mining_rate: m.mining_rate,
          mining_rate_usd: m.mining_rate_usd,
        };
      });
    }

    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (adminRoles ?? []).map((r: any) => r.user_id).filter(Boolean);

    // Public ranking payload: never expose other users' balances or raw
    // Telegram IDs. Only the display fields the leaderboard UI renders.
    const query = supabaseAdmin
      .from("profiles")
      .select("username, first_name, avatar_url, mining_rate, mining_rate_usd, balance")
      .order("mining_rate_usd", { ascending: false })
      .order("balance", { ascending: false })
      .limit(100);
    if (adminIds.length > 0) {
      query.not("user_id", "in", `(${adminIds.join(",")})`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((p: any) => ({
      username: p.username ?? null,
      first_name: p.first_name ?? null,
      avatar_url: p.avatar_url ?? null,
      hashrate: 0,
      est_daily_usd: 0,
      est_daily_gram: 0,
      mining_rate: Number(p.mining_rate ?? 0),
      mining_rate_usd: Number(p.mining_rate_usd ?? 0),
    }));
  });

// Returns the current user's global rank (hashrate under Dynamic Mining v2).
// Admins are excluded from the ranking to keep the leaderboard focused on users.
export const getMyRank = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isEconomyV2, myRankByHashrate } = await import("@/lib/leaderboard.server");

    if (await isEconomyV2()) {
      const r = await myRankByHashrate(context.userId);
      return { rank: r.rank, hashrate: r.hashrate, rate_usd: r.hashrate / 100 };
    }

    const { data: me, error: meErr } = await supabaseAdmin
      .from("profiles")
      .select("mining_rate_usd")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (meErr) throw meErr;
    const myRate = Number((me as any)?.mining_rate_usd ?? 0);

    // Exclude admins from the rank calculation, matching the top-miners list.
    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (adminRoles ?? []).map((r) => r.user_id).filter(Boolean);

    const query = supabaseAdmin
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .gt("mining_rate_usd", myRate);
    if (adminIds.length > 0) {
      query.not("user_id", "in", `(${adminIds.join(",")})`);
    }
    const { count, error } = await query;
    if (error) throw error;
    return { rank: (count ?? 0) + 1, hashrate: 0, rate_usd: myRate };
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
    // Chunk the IN() filter — PostgREST enforces a URL length limit, and a
    // single .in() with hundreds of UUIDs silently returns nothing, leaving
    // the friends list rendering fallback IDs instead of names/avatars.
    const CHUNK = 100;
    const profs: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data: part, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id, username, first_name, last_name, avatar_url, telegram_id")
        .in("user_id", slice);
      if (pErr) throw pErr;
      if (part) profs.push(...part);
    }
    const map = new Map(profs.map((p: any) => [p.user_id, p]));

    return rows.map((r: any) => ({
      ...r,
      profile: map.get(r.referred_id) ?? null,
    }));
  });

export const getReferralStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Use admin client — the RPC is SECURITY DEFINER and only granted to
    // service_role. The user id is bound to the authenticated caller so
    // callers cannot query another user's referral stats.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("get_referral_stats" as never, { _user_id: context.userId } as never);
    if (error) throw error;

    const stats: any = data ?? {};
    if (stats?.inviter?.user_id) {
      const { data: inviterProfile } = await supabaseAdmin
        .from("profiles")
        .select("telegram_id")
        .eq("user_id", stats.inviter.user_id)
        .maybeSingle();
      stats.inviter.telegram_id = (inviterProfile as any)?.telegram_id ?? null;
    }

    return stats as {
      inviter: {
        user_id: string;
        username: string | null;
        first_name: string | null;
        last_name: string | null;
        avatar_url: string | null;
        telegram_id?: number | null;
      } | null;
      level1: number;
      level2: number;
      level3: number;
      total_referrals: number;
      total_earned: number;
    };

  });

export const listReferralMilestones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc(
      "list_referral_milestones" as never,
      { _user_id: context.userId } as never,
    );
    if (error) throw error;
    return (data ?? []) as Array<{
      tier: number;
      required: number;
      reward: number;
      claimed: boolean;
      active_count: number;
    }>;
  });

export const claimReferralMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tier: number }) =>
    z.object({ tier: z.number().int().min(1).max(7) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertNotBanned(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase.rpc(
      "claim_referral_milestone" as never,
      { _tier: data.tier } as never,
    );
    if (error) throw error;
    const row = Array.isArray(rows) ? (rows[0] as { reward: number; new_balance: number } | undefined) : undefined;
    if (!row) throw new Error("claim failed");
    return { reward: Number(row.reward), newBalance: Number(row.new_balance) };
  });





// ============= Partner Tasks =============
// Users create promoted tasks (channel/group/bot/link) and pay via TON to
// promote them. Cost: 0.001 TON per click, minimum 250 clicks (0.25 TON).
// Reward per click: 0.001 GRAM. Auto-completes when target_clicks is reached.


// Public list: active partner tasks the user has not completed and does not own.
export const listPartnerTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Admin client: RPC is SECURITY DEFINER and only granted to service_role.
    // _user_id is bound to the authenticated caller and used only to filter
    // out the caller's own tasks and already-completed tasks.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc(
      "list_active_partner_tasks" as never,
      { _user_id: context.userId } as never,
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
    await assertNotBanned(context.supabase, context.userId);
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Admins can publish partner tasks for free (auto-active, no payment).
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    const costTon = isAdmin ? 0 : Number((data.targetClicks * PARTNER_COST_PER_CLICK).toFixed(6));

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
        status: isAdmin ? "active" : "pending_payment",
      })
      .select()
      .single();
    if (iErr) throw iErr;
    return { ...inserted, is_admin_free: !!isAdmin };
  });

// Called after the user visits the partner's link. Atomically records the
// completion, credits +0.001 GRAM, and auto-completes the task when target
// is reached. Enforces one completion per user and prevents owner self-claim.
export const completePartnerTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partnerTaskId: string }) =>
    z.object({ partnerTaskId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertNotBanned(context.supabase, context.userId);
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

