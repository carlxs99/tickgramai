import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  adminAddRevenue,
  adminEconomyOverview,
  adminRunPayout,
  adminSetEconomySettings,
} from "@/lib/economy.functions";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-background/50 border border-white/5 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {label}
      </p>
      <p className={`text-base font-display font-bold mt-0.5 ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

export function AdminEconomySection() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(adminEconomyOverview);
  const addRevenueFn = useServerFn(adminAddRevenue);
  const setSettingsFn = useServerFn(adminSetEconomySettings);
  const runPayoutFn = useServerFn(adminRunPayout);

  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("operator");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-economy"],
    queryFn: () => overviewFn(),
    refetchInterval: 30_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-economy"] });

  const lastPool = data?.pools?.[0] as
    | { day: string; pool_usd: number; solvency_ratio: number | null; treasury_ton: number; users_paid: number; status: string }
    | undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Revenue today" value={`$${(data?.revenueToday ?? 0).toFixed(2)}`} />
        <Stat label="From deposits (daily)" value={`$${(data?.deferredDaily ?? 0).toFixed(2)}`} />
        <Stat label="Payout ratio" value={`${((data?.payoutRatio ?? 0) * 100).toFixed(0)}%`} />
        <Stat
          label="Network hashrate"
          value={`${Math.round(data?.networkHashrate ?? 0).toLocaleString()} pts`}
        />
        <Stat label="User debt" value={`${(data?.debtGram ?? 0).toFixed(2)} GRAM`} />
        <Stat label="Treasury (wallet)" value={`${(lastPool?.treasury_ton ?? 0).toFixed(2)} GRAM`} />
        <Stat
          label="Solvency"
          value={lastPool?.solvency_ratio != null ? Number(lastPool.solvency_ratio).toFixed(2) : "—"}
          tone={
            lastPool?.solvency_ratio != null && Number(lastPool.solvency_ratio) < 1.2
              ? "text-[color:var(--warning,#f59e0b)]"
              : "text-[color:var(--success)]"
          }
        />
      </div>

      {/* Flag + manual run */}
      <div className="glass-card rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Economy v2</p>
            <p className="text-[10px] text-muted-foreground">
              {data?.enabled ? "Enabled — daily pool payouts active" : "Disabled — legacy 3.3% ROI"}
            </p>
          </div>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await setSettingsFn({ data: { enabled: !data?.enabled } });
                toast.success(data?.enabled ? "Economy v2 disabled" : "Economy v2 enabled");
                refresh();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-primary to-accent text-primary-foreground disabled:opacity-50"
          >
            {data?.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            defaultValue={data?.payoutRatio ?? 0.65}
            onBlur={async (e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v) || v < 0 || v > 1) return;
              await setSettingsFn({ data: { payoutRatio: v } });
              toast.success("Payout ratio saved");
              refresh();
            }}
            className="flex-1 bg-background/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs"
          />
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await runPayoutFn({ data: {} });
                toast.success(`Payout run for ${r.day}`);
                refresh();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/10 disabled:opacity-50"
          >
            Run payout now
          </button>
        </div>
      </div>

      {/* Manual revenue */}
      <div className="glass-card rounded-2xl p-3 space-y-2">
        <p className="text-sm font-semibold">Add revenue</p>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-background/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs"
          >
            <option value="operator">Operator funding</option>
            <option value="other">Other</option>
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount USD"
            inputMode="decimal"
            className="bg-background/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs"
          />
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="w-full bg-background/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs"
        />
        <button
          disabled={busy || !amount}
          onClick={async () => {
            const v = Number(amount);
            if (!Number.isFinite(v) || v === 0) return toast.error("Invalid amount");
            setBusy(true);
            try {
              await addRevenueFn({ data: { source, amountUsd: v, note: note || undefined } });
              setAmount("");
              setNote("");
              toast.success("Revenue recorded");
              refresh();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="w-full py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-primary to-accent text-primary-foreground disabled:opacity-50"
        >
          Record revenue
        </button>
      </div>

      {/* Payout history */}
      <div className="glass-card rounded-2xl p-3">
        <p className="text-sm font-semibold mb-2">Daily payouts</p>
        <div className="space-y-1.5">
          {(data?.pools ?? []).map((p: any) => (
            <div
              key={p.day}
              className="flex items-center justify-between text-[11px] rounded-lg bg-background/40 px-2.5 py-2"
            >
              <span className="font-mono">{p.day}</span>
              <span>${Number(p.pool_usd).toFixed(2)}</span>
              <span className="text-muted-foreground">{p.users_paid} users</span>
              <span
                className={
                  p.status === "done" ? "text-[color:var(--success)]" : "text-muted-foreground"
                }
              >
                {p.status}
              </span>
            </div>
          ))}
          {(data?.pools ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No payouts yet</p>
          )}
        </div>
      </div>

      {/* Recent revenue */}
      <div className="glass-card rounded-2xl p-3">
        <p className="text-sm font-semibold mb-2">Recent revenue</p>
        <div className="space-y-1.5">
          {(data?.recentRevenue ?? []).map((r: any) => (
            <div
              key={r.id}
              className="flex items-center justify-between text-[11px] rounded-lg bg-background/40 px-2.5 py-2"
            >
              <span className="font-semibold">{r.source}</span>
              <span className="text-muted-foreground">
                {new Date(r.occurred_at).toISOString().slice(0, 16).replace("T", " ")}
              </span>
              <span className="text-[color:var(--success)]">
                +${Number(r.amount_usd).toFixed(4)}
              </span>
            </div>
          ))}
          {(data?.recentRevenue ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No revenue yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
