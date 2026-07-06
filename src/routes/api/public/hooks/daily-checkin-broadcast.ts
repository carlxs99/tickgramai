import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://t.me/Tickgramaibot/app";
const BROADCAST_TEXT =
  `⛏️ <b>Don't lose your GRAM rewards!</b>\n\n` +
  `Time to check in and collect your mined GRAM.\n\n` +
  `💎 Your miner keeps working 24/7 — but you must check in daily to secure your rewards.\n\n` +
  `👉 Open the app now and claim what you've earned today!`;

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

async function runBroadcast() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: users, error } = await supabase
    .from("profiles")
    .select("telegram_id")
    .not("telegram_id", "is", null);

  if (error) {
    console.error("[daily-checkin-broadcast] fetch users error:", error.message);
    return;
  }

  const reply_markup = {
    inline_keyboard: [[{ text: "⛏️ Check In & Claim GRAM", url: APP_URL }]],
  };

  const list = (users ?? [])
    .map((u: any) => u.telegram_id)
    .filter((id: any) => id != null);

  console.log(`[daily-checkin-broadcast] starting broadcast to ${list.length} users`);

  let sent = 0;
  let failed = 0;
  const CONCURRENCY = 20;

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
            return r2.status >= 200 && r2.status < 300;
          }
          return r.status >= 200 && r.status < 300 && (r.data as any)?.ok !== false;
        } catch {
          return false;
        }
      }),
    );
    for (const ok of results) ok ? sent++ : failed++;
    await new Promise((res) => setTimeout(res, 800));
  }

  console.log(`[daily-checkin-broadcast] done. sent=${sent} failed=${failed} total=${list.length}`);
}

async function handleBroadcast(request: Request) {
  const apiKey = request.headers.get("apikey") ?? request.headers.get("x-api-key") ?? "";
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!expected || apiKey !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.LOVABLE_API_KEY || !process.env.TELEGRAM_API_KEY) {
    return new Response("Telegram not configured", { status: 500 });
  }

  try {
    const { waitUntil } = (await import("cloudflare:workers" as any)) as { waitUntil: (p: Promise<unknown>) => void };
    waitUntil(runBroadcast());
  } catch {
    runBroadcast().catch((e) => console.error("[daily-checkin-broadcast] error:", e));
  }

  return Response.json({ ok: true, status: "accepted" }, { status: 202 });
}

export const Route = createFileRoute("/api/public/hooks/daily-checkin-broadcast")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBroadcast(request),
      GET: async ({ request }) => handleBroadcast(request),
    },
  },
});
