import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

function deriveWebhookSecret(apiKey: string) {
  return createHash("sha256").update(`telegram-webhook:${apiKey}`).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

async function sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY!;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY!;
  await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...extra }),
  });
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
        if (!TELEGRAM_API_KEY) return new Response("Not configured", { status: 500 });

        const expected = deriveWebhookSecret(TELEGRAM_API_KEY);
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(got, expected)) return new Response("Unauthorized", { status: 401 });

        const update: any = await request.json();
        const msg = update.message ?? update.edited_message;
        const chatId = msg?.chat?.id;
        const text = (msg?.text ?? "").trim();

        if (chatId && text) {
          if (text.startsWith("/start")) {
            const payload = text.slice("/start".length).trim();
            const appDeepLink = payload
              ? `https://t.me/Tickgramaibot/app?startapp=${encodeURIComponent(payload)}`
              : `https://t.me/Tickgramaibot/app`;
            await sendMessage(
              chatId,
              `🤖 <b>TICK GRAM AI</b>\n\nWelcome! Mine GRAM 24/7: every deposit earns a fixed <b>3.3% per day</b>, and your miner keeps working even while you're away.\n\n⛏️ Earnings every second — tap Collect in the app anytime\n🎁 Free daily gift boxes, prize wheel and 3-level referrals (10% / 5% / 3%)\n💸 Minimum withdrawal 1 GRAM — once every 24h`,
              {
                reply_markup: {
                  inline_keyboard: [[
                    { text: "🚀 Open TICK GRAM AI", url: appDeepLink },
                  ]],
                },
              },
            );
          } else if (text.startsWith("/help")) {
            await sendMessage(chatId, "Use /start to open TICK GRAM AI.");
          }
        }

        return Response.json({ ok: true });
      },
    },
  },
});
