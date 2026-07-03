import { createServerFn } from "@tanstack/react-start";

// Simple in-memory cache. Worker instances may reset — that's fine, we just refetch.
let cache: { price: number; at: number } | null = null;
const TTL_MS = 15_000;

async function fromBinance(): Promise<number | null> {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT", {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { price?: string };
    const p = j.price ? Number(j.price) : NaN;
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch { return null; }
}

async function fromCoingecko(): Promise<number | null> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      { headers: { accept: "application/json" } },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { "the-open-network"?: { usd?: number } };
    const p = j["the-open-network"]?.usd;
    return typeof p === "number" && p > 0 ? p : null;
  } catch { return null; }
}

async function fromCoinbase(): Promise<number | null> {
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/TON-USD/spot", {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { amount?: string } };
    const p = j.data?.amount ? Number(j.data.amount) : NaN;
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch { return null; }
}

export async function fetchTonPriceUsdt(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.price;
  const price =
    (await fromBinance()) ??
    (await fromCoingecko()) ??
    (await fromCoinbase());
  if (price != null) {
    cache = { price, at: Date.now() };
    return price;
  }
  if (cache) return cache.price;
  return 0;
}

export const getTonPrice = createServerFn({ method: "GET" }).handler(async () => {
  const cachedHit = cache && Date.now() - cache.at < TTL_MS;
  const price = await fetchTonPriceUsdt();
  return { price, cached: !!cachedHit };
});
