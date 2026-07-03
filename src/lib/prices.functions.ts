import { createServerFn } from "@tanstack/react-start";

// Simple in-memory cache. Worker instances may reset — that's fine, we just refetch.
let cache: { price: number; at: number } | null = null;
const TTL_MS = 60_000;

export const getTonPrice = createServerFn({ method: "GET" }).handler(async () => {
  if (cache && Date.now() - cache.at < TTL_MS) return { price: cache.price, cached: true };
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      { headers: { accept: "application/json" } },
    );
    if (!r.ok) throw new Error(`price fetch ${r.status}`);
    const j = (await r.json()) as { "the-open-network"?: { usd?: number } };
    const price = j["the-open-network"]?.usd;
    if (typeof price !== "number") throw new Error("no price");
    cache = { price, at: Date.now() };
    return { price, cached: false };
  } catch {
    // Fallback: stale cache or a sensible default so UI doesn't break
    if (cache) return { price: cache.price, cached: true };
    return { price: 5.5, cached: true };
  }
});
