import { createFileRoute } from "@tanstack/react-router";

// Server proxy for Telegram user avatars (t.me/i/userpic/...).
// Telegram serves avatars with Cross-Origin-Resource-Policy: same-origin and
// hotlink protection that make cross-origin <img> loads fail in the browser.
// This endpoint refetches the image server-side and streams it back with
// permissive CORS/CORP headers, plus a long cache to keep it cheap.

const ALLOWED_HOSTS = new Set(["t.me", "telegram.me"]);

function avatarHeaders(contentType = "image/jpeg") {
  return {
    "content-type": contentType,
    "cache-control": "public, max-age=86400, s-maxage=86400, immutable",
    "cross-origin-resource-policy": "cross-origin",
    "access-control-allow-origin": "*",
  };
}

async function fetchTelegramAvatarById(telegramId: string): Promise<Response | null> {
  if (!/^\d{3,20}$/.test(telegramId)) return null;
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) return null;

  const gatewayHeaders = {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": TELEGRAM_API_KEY,
    "Content-Type": "application/json",
  };

  const photosResp = await fetch("https://connector-gateway.lovable.dev/telegram/getUserProfilePhotos", {
    method: "POST",
    headers: gatewayHeaders,
    body: JSON.stringify({ user_id: Number(telegramId), limit: 1 }),
  });
  const photosJson: any = await photosResp.json().catch(() => null);
  if (!photosResp.ok || !photosJson?.ok || !photosJson.result?.photos?.[0]?.length) return null;

  const photo = [...photosJson.result.photos[0]].sort(
    (a: any, b: any) => Number(b.file_size ?? (b.width && b.height ? b.width * b.height : 0)) - Number(a.file_size ?? (a.width && a.height ? a.width * a.height : 0)),
  )[0];
  if (!photo?.file_id) return null;

  const fileResp = await fetch("https://connector-gateway.lovable.dev/telegram/getFile", {
    method: "POST",
    headers: gatewayHeaders,
    body: JSON.stringify({ file_id: photo.file_id }),
  });
  const fileJson: any = await fileResp.json().catch(() => null);
  const filePath = fileJson?.result?.file_path;
  if (!fileResp.ok || !fileJson?.ok || typeof filePath !== "string") return null;

  const imageResp = await fetch(`https://connector-gateway.lovable.dev/telegram/file/${filePath}`, {
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
    },
  });
  if (!imageResp.ok || !imageResp.body) return null;
  const contentType = imageResp.headers.get("content-type");
  return new Response(imageResp.body, {
    status: 200,
    headers: avatarHeaders(contentType && contentType !== "application/octet-stream" ? contentType : "image/jpeg"),
  });
}

async function isKnownTelegramProfile(telegramId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id")
    .eq("telegram_id", Number(telegramId))
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return !!data?.user_id;
}

export const Route = createFileRoute("/api/public/avatar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const target = reqUrl.searchParams.get("u");
        const telegramId = reqUrl.searchParams.get("id");

        if (telegramId && (await isKnownTelegramProfile(telegramId))) {
          try {
            const telegramAvatar = await fetchTelegramAvatarById(telegramId);
            if (telegramAvatar) return telegramAvatar;
          } catch {
            // Fall back to the stored t.me URL below.
          }
        }

        if (!target) return new Response("missing avatar source", { status: 404 });

        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          return new Response("invalid url", { status: 400 });
        }

        if (!ALLOWED_HOSTS.has(parsed.hostname) || !parsed.pathname.startsWith("/i/userpic/")) {
          return new Response("host not allowed", { status: 400 });
        }

        try {
          const upstream = await fetch(parsed.toString(), {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; TickGramBot/1.0)",
              Accept: "image/*,*/*;q=0.8",
            },
          });
          if (!upstream.ok || !upstream.body) {
            return new Response("upstream error", { status: 502 });
          }
          const contentType = upstream.headers.get("content-type") ?? "image/svg+xml";
          return new Response(upstream.body, {
            status: 200,
            headers: avatarHeaders(contentType),
          });
        } catch {
          return new Response("fetch failed", { status: 502 });
        }
      },
    },
  },
});
