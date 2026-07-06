import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://t.me/Tickgramaibot/app";
const BROADCAST_TEXT =
  `🎁 <b>Your FREE daily Gift Box is ready!</b>\n\n` +
  `Open the app now and claim your free daily gift box.\n\n` +
  `✨ Every box boosts your GRAM mining rate — don't miss today's reward!\n\n` +
  `⏰ You can claim a new free box every 24 hours.`;

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

async function handleBroadcast(request: Request) {
  const apiKey = request.headers.get("apikey") ?? request.headers.get("x-api-key") ?? "";
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!expected || apiKey !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.LOVABLE_API_KEY || !process.env.TELEGRAM_API_KEY) {
    return new Response("Telegram not configured", { status: 500 });
  }

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
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const reply_markup = {
    inline_keyboard: [[{ text: "🎁 Claim Free Gift Box", url: APP_URL }]],
  };

  let sent = 0;
  let failed = 0;
  const errors: Array<{ chat_id: number; status: number }> = [];

  for (const u of users ?? []) {
    const chatId = (u as any).telegram_id;
    if (!chatId) continue;
    try {
      const r = await sendMessage(chatId, BROADCAST_TEXT, { reply_markup });
      if (r.status >= 200 && r.status < 300 && (r.data as any)?.ok !== false) {
        sent++;
      } else {
        failed++;
        if (errors.length < 10) errors.push({ chat_id: chatId, status: r.status });
        // Handle rate limit
        if (r.status === 429) {
          const retryAfter = Number((r.data as any)?.parameters?.retry_after ?? 1);
          await new Promise((res) => setTimeout(res, (retryAfter + 1) * 1000));
        }
      }
    } catch {
      failed++;
    }
    // ~25 msg/s to stay well under Telegram's 30 msg/s broadcast cap
    await new Promise((res) => setTimeout(res, 40));
  }

  return Response.json({ ok: true, total: users?.length ?? 0, sent, failed, errors });
}

export const Route = createFileRoute("/api/public/hooks/daily-gift-broadcast")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBroadcast(request),
      GET: async ({ request }) => handleBroadcast(request),
    },
  },
});
