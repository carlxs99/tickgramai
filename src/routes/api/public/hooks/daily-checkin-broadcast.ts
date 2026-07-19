import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://t.me/Tickgramaibot/app";
const JOB_NAME = "daily-checkin-broadcast";
const BROADCAST_TEXT =
  `⛏️ <b>Don't lose your GRAM rewards!</b>\n\n` +
  `Time to check in and collect your mined GRAM.\n\n` +
  `💎 Your miner keeps working 24/7 — but you must check in daily to secure your rewards.\n\n` +
  `👉 Open the app now and claim what you've earned today!`;
const REPLY_MARKUP = {
  inline_keyboard: [[{ text: "⛏️ Check In & Claim GRAM", url: APP_URL }]],
};

const CHUNK_SIZE = 500;
const CONCURRENCY = 30;
const BATCH_PAUSE_MS = 250;
const RUN_MAX_AGE_MIN = 180;

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

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getOrCreateRun(
  supabase: ReturnType<typeof supa>,
  opts: { forceNew?: boolean; onlyChatId?: string | number },
) {
  const cutoffIso = new Date(Date.now() - RUN_MAX_AGE_MIN * 60_000).toISOString();

  if (!opts.forceNew) {
    const { data: existing } = await supabase
      .from("broadcast_runs")
      .select("id, total, sent, failed, progress")
      .eq("job", JOB_NAME)
      .is("finished_at", null)
      .gte("started_at", cutoffIso)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return { runId: existing.id as string, created: false };
  }

  let total = 0;
  if (opts.onlyChatId != null) {
    total = 1;
  } else {
    const { count } = await supabase
      .from("profiles")
      .select("telegram_id", { count: "exact", head: true })
      .not("telegram_id", "is", null);
    total = count ?? 0;
  }

  const { data: created, error } = await supabase
    .from("broadcast_runs")
    .insert({ job: JOB_NAME, total, sent: 0, failed: 0, progress: 0 })
    .select("id")
    .single();
  if (error || !created) throw new Error(`create run: ${error?.message}`);
  return { runId: created.id as string, created: true };
}

async function processChunk(opts: { forceNew?: boolean; onlyChatId?: string | number }) {
  const supabase = supa();
  const { runId } = await getOrCreateRun(supabase, opts);

  const { data: run, error: runErr } = await supabase
    .from("broadcast_runs")
    .select("id, total, sent, failed, progress, finished_at")
    .eq("id", runId)
    .single();
  if (runErr || !run) throw new Error(`load run: ${runErr?.message}`);
  if (run.finished_at) return { runId, done: true, skipped: "already_finished" };

  let slice: (number | string)[];
  if (opts.onlyChatId != null) {
    slice = run.progress === 0 ? [opts.onlyChatId] : [];
  } else {
    const from = run.progress ?? 0;
    const to = from + CHUNK_SIZE - 1;
    const { data, error } = await supabase
      .from("profiles")
      .select("telegram_id")
      .not("telegram_id", "is", null)
      .order("telegram_id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`fetch slice: ${error.message}`);
    slice = (data ?? []).map((u: any) => u.telegram_id).filter((id: any) => id != null);
  }

  console.log(`[${JOB_NAME}] run=${runId} chunk from=${run.progress} size=${slice.length}/${run.total}`);

  let sent = run.sent ?? 0;
  let failed = run.failed ?? 0;
  let lastError: string | null = null;

  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const batch = slice.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (chatId) => {
        try {
          const r = await sendMessage(chatId, BROADCAST_TEXT, { reply_markup: REPLY_MARKUP });
          if (r.status === 429) {
            const retryAfter = Number((r.data as any)?.parameters?.retry_after ?? 1);
            await new Promise((res) => setTimeout(res, Math.min(retryAfter + 1, 5) * 1000));
            const r2 = await sendMessage(chatId, BROADCAST_TEXT, { reply_markup: REPLY_MARKUP });
            const ok2 = r2.status >= 200 && r2.status < 300 && (r2.data as any)?.ok !== false;
            return ok2 ? { ok: true } : { ok: false, err: `retry ${r2.status} ${JSON.stringify(r2.data).slice(0, 200)}` };
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

  const newProgress = (run.progress ?? 0) + slice.length;
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

  console.log(`[${JOB_NAME}] run=${runId} progress=${newProgress}/${run.total} sent=${sent} failed=${failed} done=${isDone}`);
  return { runId, done: isDone, progress: newProgress, total: run.total, sent, failed };
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
    new URL(request.url).searchParams.get("secret") ||
    "";
  return provided.length > 0 && safeEqual(provided, expected);
}

async function handleBroadcast(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  if (!process.env.LOVABLE_API_KEY || !process.env.TELEGRAM_API_KEY) {
    return new Response("Telegram not configured", { status: 500 });
  }

  const url = new URL(request.url);
  const onlyChatId = url.searchParams.get("chat_id") ?? undefined;
  const forceNew = url.searchParams.get("start") === "1";

  try {
    const result = await processChunk({ forceNew, onlyChatId });
    return Response.json({ ok: true, ...result });
  } catch (e: any) {
    console.error(`[${JOB_NAME}] error:`, e);
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/daily-checkin-broadcast")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBroadcast(request),
      GET: async ({ request }) => handleBroadcast(request),
    },
  },
});
