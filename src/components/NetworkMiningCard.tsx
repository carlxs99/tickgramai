import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Activity, Gauge, PieChart, TrendingUp } from "lucide-react";
import { getNetworkMining } from "@/lib/economy.functions";
import { formatReward } from "@/lib/format";
import { useT } from "@/i18n";

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-secondary/60 border border-border p-2.5">
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-sm font-display font-bold leading-tight text-card-foreground">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

/** Shows the user's share of the network mining pool (Dynamic Mining v2). */
export function NetworkMiningCard() {
  const { t } = useT();
  const fn = useServerFn(getNetworkMining);
  const { data } = useQuery({
    queryKey: ["network-mining"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
  });

  if (!data || !data.enabled) return null;

  const sharePct = (data.share * 100).toFixed(data.share < 0.001 ? 4 : 2);
  const last = data.lastPayout;

  return (
    <div className="glass-card rounded-2xl p-4 border border-border text-card-foreground">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-accent/20 border border-primary/30 flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="eyebrow text-muted-foreground !text-[9px]">{t("mining.eyebrow")}</p>
            <h3 className="text-sm font-display font-bold leading-tight">{t("mining.title")}</h3>
          </div>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-[color:var(--success)]/10 border border-[color:var(--success)]/20 text-[color:var(--success)] font-semibold">
          {t("mining.live")}
        </span>
      </div>

      <div className="rounded-xl p-3 mb-2 bg-gradient-to-br from-primary/15 to-accent/10 border border-primary/25">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
          {t("mining.est_today")}
        </p>
        <p className="text-xl font-display font-bold text-gradient leading-tight">
          ≈ {formatReward(data.estDailyGram)} GRAM
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {t("mining.est_sub", {
            usd: data.estDailyUsd.toFixed(4),
            gram: formatReward(data.estMonthlyGram),
          })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric
          icon={<Gauge className="w-3 h-3" />}
          label={t("mining.hashrate")}
          value={`${Math.round(data.myHashrate).toLocaleString()} pts`}
          sub={t("mining.power_valid")}
        />
        <Metric
          icon={<PieChart className="w-3 h-3" />}
          label={t("mining.share")}
          value={`${sharePct}%`}
        />
        <Metric
          icon={<TrendingUp className="w-3 h-3" />}
          label={t("mining.yesterday")}
          value={last ? `${formatReward(Number(last.amount_gram))} GRAM` : "—"}
          sub={last ? `≈ $${Number(last.amount_usd).toFixed(4)}` : t("mining.first_payout")}
        />
        <Metric
          icon={<TrendingUp className="w-3 h-3" />}
          label={t("mining.apy")}
          value={data.apy > 0 ? `${data.apy.toFixed(1)}%` : "—"}
          sub={t("mining.apy_sub")}
        />
      </div>

      <p className="text-[10px] text-muted-foreground mt-3 leading-snug">{t("mining.footer")}</p>
    </div>
  );
}
