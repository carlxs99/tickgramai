import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://t.me/Tickgramaibot/app";
const JOB_NAME = "daily-gift-broadcast";
const BROADCAST_TEXT =
  `🎁 <b>Your 3 FREE daily Gift Boxes are ready!</b>\n\n` +
  `Open the app now and claim your 3 free daily gift boxes.\n\n` +
  `✨ Every box boosts your GRAM mining rate — don't miss today's rewards!\n\n` +
  `⏰ You can claim 3 new free boxes every 24 hours.`;

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

async function runBroadcast(opts: { onlyChatId?: string | number } = {}) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const reply_markup = {
    inline_keyboard: [[{ text: "🎁 Claim Free Gift Box", url: APP_URL }]],
  };

  let list: (number | string)[];
  if (opts.onlyChatId != null) {
    list = [opts.onlyChatId];
  } else {
    const { data: users, error } = await supabase
      .from("profiles")
      .select("telegram_id")
      .not("telegram_id", "is", null);
    if (error) {
      console.error(`[${JOB_NAME}] fetch users error:`, error.message);
      return;
    }
    list = (users ?? []).map((u: any) => u.telegram_id).filter((id: any) => id != null);
  }

  const { data: runRow } = await supabase
    .from("broadcast_runs")
    .insert({ job: JOB_NAME, total: list.length })
    .select("id")
    .single();
  const runId = runRow?.id as string | undefined;

  console.log(`[${JOB_NAME}] starting broadcast to ${list.length} users (run=${runId})`);

  let sent = 0;
  let failed = 0;
  let lastError: string | null = null;
  const CONCURRENCY = 25;
  const BATCH_PAUSE_MS = 400;

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (chatId) => {
        try {
          const r = await sendMessage(chatId, BROADCAST_TEXT, { reply_markup });
          if (r.status === 429) {
            const retryAfter = Number((r.data as any)?.parameters?.retry_after ?? 1);
            await new Promise((res) => setTimeout(res, (retryAfter + 1) * 1000));
            const r2 = await sendMessage(chatId, BROADCAST_TEXT, { reply_markup });
            if (!(r2.status >= 200 && r2.status < 300 && (r2.data as any)?.ok !== false)) {
              return { ok: false, err: `retry ${r2.status} ${JSON.stringify(r2.data).slice(0, 200)}` };
            }
            return { ok: true };
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
    if (runId) {
      await supabase
        .from("broadcast_runs")
        .update({ sent, failed, progress: i + batch.length, last_error: lastError })
        .eq("id", runId);
    }
    await new Promise((res) => setTimeout(res, BATCH_PAUSE_MS));
  }

  if (runId) {
    await supabase
      .from("broadcast_runs")
      .update({ sent, failed, progress: list.length, last_error: lastError, finished_at: new Date().toISOString() })
      .eq("id", runId);
  }

  console.log(`[${JOB_NAME}] done. sent=${sent} failed=${failed} total=${list.length}`);
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
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.LOVABLE_API_KEY || !process.env.TELEGRAM_API_KEY) {
    return new Response("Telegram not configured", { status: 500 });
  }

  const url = new URL(request.url);
  const onlyChatId = url.searchParams.get("chat_id") ?? undefined;

  const task = runBroadcast({ onlyChatId }).catch((e) =>
    console.error(`[${JOB_NAME}] error:`, e),
  );

  try {
    const { waitUntil } = (await import("cloudflare:workers" as any)) as {
      waitUntil: (p: Promise<unknown>) => void;
    };
    waitUntil(task);
  } catch {
    // Local dev fallback
  }

  return Response.json({ ok: true, status: "accepted" }, { status: 202 });
}

export const Route = createFileRoute("/api/public/hooks/daily-gift-broadcast")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBroadcast(request),
      GET: async ({ request }) => handleBroadcast(request),
    },
  },
});
