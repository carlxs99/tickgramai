import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/tonconnect-manifest.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        return Response.json({
          url: origin,
          name: "Ultra Gram Miner",
          iconUrl: `${origin}/favicon.ico`,
        }, {
          headers: { "cache-control": "public, max-age=300" },
        });
      },
    },
  },
});
