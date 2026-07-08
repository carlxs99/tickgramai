import { createFileRoute } from "@tanstack/react-router";

// Server proxy for MEXC ticker prices.
// MEXC's public REST does not send CORS headers, so browsers block direct
// calls from the app. This route fetches server-side and returns a compact
// JSON map of { SYMBOL: { price, changePct } } used by the stats stream
// for TON-ecosystem tokens not listed on Binance.
const ALLOWED_PAIRS = new Set([
  "MAJORUSDT",
  "XUSDT",
  "REDOUSDT",
  "PXUSDT",
  "GEMSUSDT",
  "ANONUSDT",
]);

export const Route = createFileRoute("/api/public/mexc-prices")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const raw = url.searchParams.get("symbols") ?? "";
        const requested = raw
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => ALLOWED_PAIRS.has(s));

        const pairs = requested.length > 0 ? requested : Array.from(ALLOWED_PAIRS);

        const results = await Promise.all(
          pairs.map(async (pair) => {
            try {
              const res = await fetch(
                `https://api.mexc.com/api/v3/ticker/24hr?symbol=${pair}`,
                { headers: { "User-Agent": "tickgram/1.0" } },
              );
              if (!res.ok) return [pair, null] as const;
              const d = (await res.json()) as {
                lastPrice: string;
                priceChangePercent: string;
              };
              return [pair, {
                price: parseFloat(d.lastPrice),
                // MEXC returns a fraction (0.05 = 5%). Normalize to percent.
                changePct: parseFloat(d.priceChangePercent) * 100,
              }] as const;
            } catch {
              return [pair, null] as const;
            }
          }),
        );

        const body: Record<string, { price: number; changePct: number }> = {};
        for (const [pair, q] of results) if (q) body[pair] = q;

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            // Small edge cache — MEXC is polled every 5s from the client.
            "Cache-Control": "public, max-age=3, s-maxage=3",
          },
        });
      },
    },
  },
});
