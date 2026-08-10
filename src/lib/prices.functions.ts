import { createServerFn } from "@tanstack/react-start";

// Simple in-memory cache. Worker instances may reset — that's fine, we just refetch.
let cache: { price: number; at: number; sources: string[] } | null = null;
const TTL_MS = 5_000;
const FETCH_TIMEOUT_MS = 4_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function isBinanceTrading(): Promise<boolean> {
  try {
    const r = await fetchWithTimeout("https://api.binance.com/api/v3/exchangeInfo?symbol=TONUSDT", {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return false;
    const j = (await r.json()) as { symbols?: Array<{ status?: string }> };
    return j.symbols?.[0]?.status === "TRADING";
  } catch {
    return false;
  }
}

async function fromBinance(): Promise<number | null> {
  try {
    // If the market is halted (BREAK, AUCTION, etc.) the price is stale.
    if (!(await isBinanceTrading())) return null;

    const r = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT", {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { price?: string };
    const p = j.price ? Number(j.price) : NaN;
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function fromCoingecko(): Promise<number | null> {
  try {
    const r = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      { headers: { accept: "application/json" } },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { "the-open-network"?: { usd?: number } };
    const p = j["the-open-network"]?.usd;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function fromCoinbase(): Promise<number | null> {
  try {
    const r = await fetchWithTimeout("https://api.coinbase.com/v2/prices/TON-USD/spot", {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { amount?: string } };
    const p = j.data?.amount ? Number(j.data.amount) : NaN;
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function fetchTonPriceUsdt(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.price;

  const results = await Promise.all([
    fromBinance().then((p) => ({ name: "binance", price: p })),
    fromCoingecko().then((p) => ({ name: "coingecko", price: p })),
    fromCoinbase().then((p) => ({ name: "coinbase", price: p })),
  ]);

  const available = results.filter((r) => r.price != null) as { name: string; price: number }[];
  const usedSources = available.map((r) => r.name);
  const prices = available.map((r) => r.price);

  const price = median(prices);
  if (price != null) {
    cache = { price, at: Date.now(), sources: usedSources };
    return price;
  }

  if (cache) return cache.price;
  return 0;
}

export const getTonPrice = createServerFn({ method: "GET" }).handler(async () => {
  const cachedHit = cache && Date.now() - cache.at < TTL_MS;
  const price = await fetchTonPriceUsdt();
  return { price, cached: !!cachedHit, sources: cache?.sources ?? [] };
});
