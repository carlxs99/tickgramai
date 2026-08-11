import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Background worker that drains admin-created custom broadcasts.
// Driven by pg_cron (every minute) so the admin does not need the app open.
const JOB_NAME = "custom-broadcast";
const CHUNK_SIZE = 500;
const CONCURRENCY = 30;
const BATCH_PAUSE_MS = 250;
const RUN_MAX_AGE_MIN = 180;

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function sendTo(
  chatId: number | string,
  b: { message: string; image_url: string | null; button_text: string | null; button_url: string | null },
) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY!;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY!;
  const reply_markup =
    b.button_url && b.button_text
      ? { inline_keyboard: [[{ text: b.button_text, url: b.button_url }]] }
      : undefined;

  const usePhoto = !!b.image_url;
  const endpoint = usePhoto ? "sendPhoto" : "sendMessage";
  const body: Record<string, unknown> = usePhoto
    ? { chat_id: chatId, photo: b.image_url, caption: b.message, parse_mode: "HTML" }
    : { chat_id: chatId, text: b.message, parse_mode: "HTML", disable_web_page_preview: true };
  if (reply_markup) body.reply_markup = reply_markup;

  const res = await fetch(`https://connector-gateway.lovable.dev/telegram/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function processChunk() {
  const supabase = supa();

  // Pick the oldest broadcast that still needs work.
  const staleIso = new Date(Date.now() - RUN_MAX_AGE_MIN * 60_000).toISOString();
  const { data: b, error } = await supabase
    .from("custom_broadcasts")
    .select("*")
    .in("status", ["queued", "running"])
    .gte("created_at", staleIso)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`load broadcast: ${error.message}`);
  if (!b) return { idle: true };

  let total = b.total ?? 0;
  if (b.status === "queued" || total === 0) {
    const { count } = await supabase
      .from("profiles")
      .select("telegram_id", { count: "exact", head: true })
      .not("telegram_id", "is", null);
    total = count ?? 0;
    await supabase
      .from("custom_broadcasts")
      .update({ status: "running", total, started_at: b.started_at ?? new Date().toISOString() })
      .eq("id", b.id);
  }

  const from = b.progress ?? 0;
  const { data: rows, error: sliceErr } = await supabase
    .from("profiles")
    .select("telegram_id")
    .not("telegram_id", "is", null)
    .order("telegram_id", { ascending: true })
    .range(from, from + CHUNK_SIZE - 1);
  if (sliceErr) throw new Error(`fetch slice: ${sliceErr.message}`);
  const slice = (rows ?? []).map((u: any) => u.telegram_id).filter((id: any) => id != null);

  console.log(`[${JOB_NAME}] id=${b.id} from=${from} size=${slice.length}/${total}`);

  let sent = b.sent ?? 0;
  let failed = b.failed ?? 0;
  let lastError: string | null = null;

  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const batch = slice.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (chatId) => {
        try {
          const r = await sendTo(chatId, b as any);
          if (r.status === 429) {
            const retryAfter = Number((r.data as any)?.parameters?.retry_after ?? 1);
            await new Promise((res) => setTimeout(res, Math.min(retryAfter + 1, 5) * 1000));
            const r2 = await sendTo(chatId, b as any);
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

  const progress = from + slice.length;
  const done = progress >= total || slice.length === 0;

  await supabase
    .from("custom_broadcasts")
    .update({
      sent,
      failed,
      progress,
      last_error: lastError,
      status: done ? "done" : "running",
      finished_at: done ? new Date().toISOString() : null,
    })
    .eq("id", b.id);

  console.log(`[${JOB_NAME}] id=${b.id} progress=${progress}/${total} sent=${sent} failed=${failed} done=${done}`);
  return { id: b.id, progress, total, sent, failed, done };
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

async function handle(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  if (!process.env.LOVABLE_API_KEY || !process.env.TELEGRAM_API_KEY) {
    return new Response("Telegram not configured", { status: 500 });
  }
  try {
    const result = await processChunk();
    return Response.json({ ok: true, ...result });
  } catch (e: any) {
    console.error(`[${JOB_NAME}] error:`, e);
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/custom-broadcast")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});
