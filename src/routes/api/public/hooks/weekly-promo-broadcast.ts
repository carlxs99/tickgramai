import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://t.me/Tickgramaibot/app";
const JOB_NAME = "weekly-promo-broadcast";

const CHUNK_SIZE = 500;
const CONCURRENCY = 30;
const BATCH_PAUSE_MS = 250;
const RUN_MAX_AGE_MIN = 180;

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildText(percent: number, endsAt: string) {
  const ends = new Date(endsAt);
  const endsStr = `${ends.getUTCDate()}/${ends.getUTCMonth() + 1} ${String(ends.getUTCHours()).padStart(2, "0")}:00 UTC`;
  return (
    `🔥 <b>WEEKLY DEPOSIT BONUS: +${percent}%</b>\n\n` +
    `For the next 48 hours every deposit is credited with a <b>+${percent}%</b> bonus for ALL users.\n\n` +
    `💎 Deposit 1 GRAM → mine as if you deposited <b>${(1 + percent / 100).toFixed(2)} GRAM</b>\n` +
    `⏰ Ends: <b>${endsStr}</b>\n\n` +
    `Already have a gift-box bonus? Don't worry — it stays saved for your next deposit.`
  );
}

async function sendMessage(chatId: number | string, text: string, extra: Record<string, unknown> = {}) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY!;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY!;
  const res = await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function getOrCreateRun(supabase: ReturnType<typeof supa>, promoCreated: boolean) {
  const cutoffIso = new Date(Date.now() - RUN_MAX_AGE_MIN * 60_000).toISOString();

  // Resume an unfinished run first.
  const { data: existing } = await supabase
    .from("broadcast_runs")
    .select("id")
    .eq("job", JOB_NAME)
    .is("finished_at", null)
    .gte("started_at", cutoffIso)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { runId: existing.id as string, created: false };

  // Only start a new broadcast when a brand-new promotion was just created.
  if (!promoCreated) return { runId: null as string | null, created: false };

  const { count } = await supabase
    .from("profiles")
    .select("telegram_id", { count: "exact", head: true })
    .not("telegram_id", "is", null);

  const { data: created, error } = await supabase
    .from("broadcast_runs")
    .insert({ job: JOB_NAME, total: count ?? 0, sent: 0, failed: 0, progress: 0 })
    .select("id")
    .single();
  if (error || !created) throw new Error(`create run: ${error?.message}`);
  return { runId: created.id as string, created: true };
}

async function processChunk(force: boolean) {
  const supabase = supa();

  // Create (or fetch) this week's promotion.
  const { data: promoRows, error: promoErr } = await supabase
    .rpc("start_weekly_deposit_promotion" as never, { _duration_hours: 48 } as never);
  if (promoErr) throw new Error(`promotion: ${promoErr.message}`);
  const promo: any = Array.isArray(promoRows) ? promoRows[0] : promoRows;
  if (!promo) throw new Error("promotion: no row");

  const text = buildText(Number(promo.percent), String(promo.ends_at));
  const replyMarkup = { inline_keyboard: [[{ text: `🔥 Deposit with +${Number(promo.percent)}%`, url: APP_URL }]] };

  const { runId } = await getOrCreateRun(supabase, Boolean(promo.created) || force);
  if (!runId) {
    return { done: true, skipped: "no_new_promotion", percent: Number(promo.percent), endsAt: promo.ends_at };
  }

  const { data: run, error: runErr } = await supabase
    .from("broadcast_runs")
    .select("id, total, sent, failed, progress, finished_at")
    .eq("id", runId)
    .single();
  if (runErr || !run) throw new Error(`load run: ${runErr?.message}`);
  if (run.finished_at) return { runId, done: true, skipped: "already_finished" };

  const from = run.progress ?? 0;
  const { data: sliceRows, error: sliceErr } = await supabase
    .from("profiles")
    .select("telegram_id")
    .not("telegram_id", "is", null)
    .order("telegram_id", { ascending: true })
    .range(from, from + CHUNK_SIZE - 1);
  if (sliceErr) throw new Error(`fetch slice: ${sliceErr.message}`);
  const slice = (sliceRows ?? []).map((u: any) => u.telegram_id).filter((id: any) => id != null);

  let sent = run.sent ?? 0;
  let failed = run.failed ?? 0;
  let lastError: string | null = null;

  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const batch = slice.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (chatId: number | string) => {
        try {
          const r = await sendMessage(chatId, text, { reply_markup: replyMarkup });
          if (r.status === 429) {
            const retryAfter = Number((r.data as any)?.parameters?.retry_after ?? 1);
            await new Promise((res) => setTimeout(res, Math.min(retryAfter + 1, 5) * 1000));
            const r2 = await sendMessage(chatId, text, { reply_markup: replyMarkup });
            const ok2 = r2.status >= 200 && r2.status < 300 && (r2.data as any)?.ok !== false;
            return ok2 ? { ok: true } : { ok: false, err: `retry ${r2.status}` };
          }
          const ok = r.status >= 200 && r.status < 300 && (r.data as any)?.ok !== false;
          return ok ? { ok: true } : { ok: false, err: `${r.status} ${JSON.stringify(r.data).slice(0, 200)}` };
        } catch (e: any) {
          return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
        }
      }),
    );
    for (const r of results) {
      if (r.ok) sent++;
      else {
        failed++;
        if (r.err) lastError = r.err;
      }
    }
    await new Promise((res) => setTimeout(res, BATCH_PAUSE_MS));
  }

  const newProgress = from + slice.length;
  const isDone = newProgress >= (run.total ?? 0) || slice.length === 0;

  await supabase
    .from("broadcast_runs")
    .update({
      sent,
      failed,
      progress: newProgress,
      last_error: lastError,
      finished_at: isDone ? new Date().toISOString() : null,
    })
    .eq("id", runId);

  console.log(`[${JOB_NAME}] run=${runId} ${newProgress}/${run.total} sent=${sent} failed=${failed} done=${isDone}`);
  return { runId, done: isDone, progress: newProgress, total: run.total, sent, failed, percent: Number(promo.percent) };
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided =
    header.replace(/^Bearer\s+/i, "").trim() ||
    request.headers.get("x-cron-secret") ||
    "";
  return provided.length > 0 && safeEqual(provided, expected);
}

async function handle(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  if (!process.env.LOVABLE_API_KEY || !process.env.TELEGRAM_API_KEY) {
    return new Response("Telegram not configured", { status: 500 });
  }
  const force = new URL(request.url).searchParams.get("start") === "1";
  try {
    const result = await processChunk(force);
    return Response.json({ ok: true, ...result });
  } catch (e: any) {
    console.error(`[${JOB_NAME}] error:`, e);
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/weekly-promo-broadcast")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});
