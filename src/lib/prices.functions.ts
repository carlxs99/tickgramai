import { createServerFn } from "@tanstack/react-start";

export const getTonPrice = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { fetchTonPriceUsdt, isPriceCacheFresh, getPriceSources } = await import(
      "@/lib/prices.server"
    );
    const cachedHit = isPriceCacheFresh();
    const price = await fetchTonPriceUsdt();
    return { price, cached: cachedHit, sources: getPriceSources() };
  } catch {
    // Never fail the request over a transient upstream/network error.
    return { price: 0, cached: false, sources: [] as string[] };
  }
});
