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
              `🤖 <b>TICK GRAM AI</b>\n\nWelcome to <b>TICK GRAM AI</b> — the smartest way to mine <b>GRAM</b> right inside Telegram.\n\n• Complete tasks and earn GRAM\n• Invite friends and earn 10% of every deposit they make\n• Deposit to boost your mining rate and earn passive income daily\n\nTap the button below to launch the app.`,
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
