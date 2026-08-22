import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Activity, Gauge, PieChart, TrendingUp } from "lucide-react";
import { getNetworkMining } from "@/lib/economy.functions";
import { formatReward } from "@/lib/format";

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
    <div className="rounded-xl bg-background/50 border border-white/5 p-2.5">
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-sm font-display font-bold leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

/** Shows the user's share of the network mining pool (Dynamic Mining v2). */
export function NetworkMiningCard() {
  const fn = useServerFn(getNetworkMining);
  const { data } = useQuery({
    queryKey: ["network-mining"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });

  if (!data || !data.enabled) return null;

  const sharePct = (data.share * 100).toFixed(data.share < 0.001 ? 4 : 2);
  const last = data.lastPayout;

  return (
    <div className="glass-card rounded-2xl p-4 border border-white/10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-accent/20 border border-primary/30 flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="eyebrow text-muted-foreground !text-[9px]">Dynamic Mining</p>
            <h3 className="text-sm font-display font-bold leading-tight">Network Mining</h3>
          </div>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-[color:var(--success)]/10 border border-[color:var(--success)]/20 text-[color:var(--success)] font-semibold">
          Live pool
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric
          icon={<Gauge className="w-3 h-3" />}
          label="Your hashrate"
          value={`${Math.round(data.myHashrate).toLocaleString()} pts`}
          sub={`Network ${Math.round(data.netHashrate).toLocaleString()} pts`}
        />
        <Metric
          icon={<PieChart className="w-3 h-3" />}
          label="Network share"
          value={`${sharePct}%`}
        />
        <Metric
          icon={<TrendingUp className="w-3 h-3" />}
          label="Yesterday"
          value={last ? `${formatReward(Number(last.amount_gram))} GRAM` : "—"}
          sub={last ? `≈ $${Number(last.amount_usd).toFixed(4)}` : "First payout pending"}
        />
        <Metric
          icon={<TrendingUp className="w-3 h-3" />}
          label="Est. APY (7d)"
          value={data.apy > 0 ? `${data.apy.toFixed(1)}%` : "—"}
          sub="Variable, based on real revenue"
        />
      </div>

      <p className="text-[10px] text-muted-foreground mt-3 leading-snug">
        Rewards are paid once a day from the network revenue pool, split by hashrate. No fixed
        rate — the more the network earns, the more you earn.
      </p>
    </div>
  );
}
