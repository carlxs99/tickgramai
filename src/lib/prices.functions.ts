import { createServerFn } from "@tanstack/react-start";

export const getTonPrice = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchTonPriceUsdt, isPriceCacheFresh, getPriceSources } = await import(
    "@/lib/prices.server"
  );
  const cachedHit = isPriceCacheFresh();
  const price = await fetchTonPriceUsdt();
  return { price, cached: cachedHit, sources: getPriceSources() };
});
