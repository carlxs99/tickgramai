import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getNetworkMining } from "@/lib/economy.functions";

/** 100 hashrate points per $1 of mining capital (matches grant_hashrate). */
export const POINTS_PER_USD = 100;

/** Mining points earned for a GRAM amount at the current GRAM price. */
export function pointsForGram(gram: number, price: number) {
  return Math.max(0, gram * (price > 0 ? price : 0) * POINTS_PER_USD);
}

export function formatPoints(pts: number) {
  if (!isFinite(pts) || pts <= 0) return "0";
  if (pts >= 1000) return Math.round(pts).toLocaleString();
  if (pts >= 10) return pts.toFixed(0);
  if (pts >= 0.01) return pts.toFixed(2).replace(/\.?0+$/, "");
  // Never render "0.00" for a positive reward: keep enough decimals to show it.
  const decimals = Math.min(8, -Math.floor(Math.log10(pts)) + 1);
  return pts.toFixed(decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Shared Dynamic Mining (economy v2) state for the whole app. */
export function useEconomy() {
  const fn = useServerFn(getNetworkMining);
  const { data } = useQuery({
    queryKey: ["network-mining"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return {
    enabled: Boolean(data?.enabled),
    myHashrate: Number(data?.myHashrate ?? 0),
    netHashrate: Number(data?.netHashrate ?? 0),
    share: Number(data?.share ?? 0),
    lastPayout: data?.lastPayout ?? null,
    apy: Number(data?.apy ?? 0),
    pendingGram: Number(data?.pendingGram ?? 0),
    pendingDays: Number(data?.pendingDays ?? 0),
    nextPayoutAt: data?.nextPayoutAt ?? null,
    data,
  };
}
