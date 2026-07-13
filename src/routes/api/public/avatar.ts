import { createFileRoute } from "@tanstack/react-router";

// Server proxy for Telegram user avatars (t.me/i/userpic/...).
// Telegram serves avatars with Cross-Origin-Resource-Policy: same-origin and
// hotlink protection that make cross-origin <img> loads fail in the browser.
// This endpoint refetches the image server-side and streams it back with
// permissive CORS/CORP headers, plus a long cache to keep it cheap.

const ALLOWED_HOST = "t.me";

export const Route = createFileRoute("/api/public/avatar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const target = reqUrl.searchParams.get("u");
        if (!target) return new Response("missing u", { status: 400 });

        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          return new Response("invalid url", { status: 400 });
        }

        if (parsed.hostname !== ALLOWED_HOST || !parsed.pathname.startsWith("/i/userpic/")) {
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
            headers: {
              "content-type": contentType,
              "cache-control": "public, max-age=86400, s-maxage=86400, immutable",
              "cross-origin-resource-policy": "cross-origin",
              "access-control-allow-origin": "*",
            },
          });
        } catch {
          return new Response("fetch failed", { status: 502 });
        }
      },
    },
  },
});
