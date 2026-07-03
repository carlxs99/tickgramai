import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { Pickaxe, ListChecks, Users, ArrowDownToLine, ArrowUpFromLine, Sparkles, Copy, CheckCircle2, Coins, Trophy, Loader2, Calculator, Lightbulb } from "lucide-react";
import { toast, Toaster } from "sonner";

import { authWithTelegram } from "@/lib/telegram-auth.functions";
import { getMe, collectIncome, listTasks, completeTask, submitDeposit, listDeposits, submitWithdrawal, listWithdrawals, getTopMiners, getFriends } from "@/lib/miner.functions";
import { getTonPrice } from "@/lib/prices.functions";
import { getTelegram, restoreSession } from "@/lib/telegram";
import { formatGram } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  component: MinerApp,
});

type Tab = "mine" | "tasks" | "friends" | "deposit" | "withdraw";

function MinerApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("mine");
  const authFn = useServerFn(authWithTelegram);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const tg = getTelegram();
    tg?.ready();
    tg?.expand();

    (async () => {
      try {
        const { data: existing } = await supabase.auth.getSession();
        if (existing.session) { setReady(true); return; }

        const initData = tg?.initData;
        const demoId = !initData ? Math.floor(1_000_000 + Math.random() * 9_000_000) : undefined;

        const tokens = await authFn({ data: { initData, demoId } });
        await restoreSession(tokens);
        setReady(true);
      } catch (e: any) {
        setError(e?.message ?? "Auth failed");
      }
    })();
  }, [authFn]);

  if (error) {
    return (
      <Center>
        <div className="text-center">
          <p className="text-destructive font-medium">Auth error</p>
          <p className="mt-2 text-sm text-muted-foreground max-w-xs">{error}</p>
        </div>
      </Center>
    );
  }
  if (!ready) return <Center><Loader2 className="w-8 h-8 animate-spin text-primary" /></Center>;

  return (
    <div className="min-h-screen pb-24 max-w-md mx-auto">
      <Toaster theme="dark" position="top-center" richColors />
      <Header />
      <AnimatePresence mode="wait">
        <motion.main
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.18 }}
          className="px-4 pt-4"
        >
          {tab === "mine" && <MineTab />}
          {tab === "tasks" && <TasksTab />}
          {tab === "friends" && <FriendsTab />}
          {tab === "deposit" && <DepositTab />}
          {tab === "withdraw" && <WithdrawTab />}
        </motion.main>
      </AnimatePresence>
      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center">{children}</div>;
}

// TON price hook — 1 GRAM = 1 TON = price USDT
function useTonPrice() {
  const fn = useServerFn(getTonPrice);
  const q = useQuery({
    queryKey: ["ton-price"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return q.data?.price ?? 5.5;
}

function usdt(gram: number, price: number) {
  const v = gram * price;
  if (!isFinite(v)) return "0.00";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function Header() {
  const meFn = useServerFn(getMe);
  const { data } = useQuery({ queryKey: ["me-header"], queryFn: () => meFn(), refetchInterval: 15000 });
  const price = useTonPrice();
  const name = data?.profile.first_name ?? data?.profile.username ?? "Miner";
  const initial = name.slice(0, 1).toUpperCase();
  const bal = Number(data?.profile.balance ?? 0);
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-white/5">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center font-bold text-primary-foreground">
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">Welcome</p>
          <p className="font-semibold truncate">{name}</p>
        </div>
        <div className="flex flex-col items-end gap-0.5 px-3 py-1.5 rounded-2xl card-glass">
          <div className="flex items-center gap-1">
            <Coins className="w-3.5 h-3.5 text-[color:var(--gold)]" />
            <span className="font-semibold text-sm">{formatGram(bal)}</span>
            <span className="text-[10px] text-muted-foreground">GRAM</span>
          </div>
          <span className="text-[10px] text-[color:var(--success)] tabular-nums">≈ ${usdt(bal, price)} USDT</span>
        </div>
      </div>
    </header>
  );
}

const meQO = (fn: () => Promise<any>) => queryOptions({ queryKey: ["me"], queryFn: fn, refetchInterval: 30000 });

function MineTab() {
  const meFn = useServerFn(getMe);
  const collectFn = useServerFn(collectIncome);
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(meQO(() => meFn()));
  const [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(i); }, []);

  const live = useMemo(() => {
    const now = Date.now();
    const last = new Date(data.profile.last_collect_at).getTime();
    const secs = Math.max(0, (now - last) / 1000);
    return (Number(data.profile.mining_rate) / 86400) * secs;
  }, [data, tick]);

  const collect = useMutation({
    mutationFn: () => collectFn(),
    onSuccess: (r) => {
      getTelegram()?.HapticFeedback?.impactOccurred("medium");
      toast.success(`+${formatGram(r.gained, 4)} GRAM collected`);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const rate = Number(data.profile.mining_rate);
  const price = useTonPrice();

  return (
    <div className="space-y-4">
      <motion.div
        className="rounded-3xl card-glass p-6 text-center glow-primary relative overflow-hidden"
        initial={{ scale: 0.96 }} animate={{ scale: 1 }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/10 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center justify-center gap-2 text-muted-foreground text-xs uppercase tracking-widest">
            <Sparkles className="w-3.5 h-3.5" /> Uncollected
          </div>
          <div className="mt-2 text-5xl font-extrabold tabular-nums">
            {formatGram(live, 4)}
          </div>
          <div className="text-xs text-[color:var(--success)] tabular-nums mt-0.5">
            ≈ ${usdt(live, price)} USDT
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {rate > 0
              ? <>{formatGram(rate, 2)} GRAM/day <span className="text-[color:var(--success)]">(≈ ${usdt(rate, price)} /day)</span></>
              : "Deposit TON to start mining"}
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => collect.mutate()}
            disabled={collect.isPending || live < 0.0001}
            className="mt-5 w-full py-4 rounded-2xl bg-gradient-to-r from-primary to-accent font-bold text-primary-foreground disabled:opacity-50 shadow-lg"
          >
            {collect.isPending ? "Collecting…" : "Collect Gram"}
          </motion.button>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Balance" value={formatGram(data.profile.balance)} sub={`≈ $${usdt(Number(data.profile.balance), price)}`} icon={<Coins className="w-4 h-4 text-[color:var(--gold)]" />} />
        <StatCard label="Deposits" value={formatGram(data.profile.deposit_total) + " TON"} sub={`1 TON ≈ $${price.toFixed(2)}`} icon={<ArrowDownToLine className="w-4 h-4 text-[color:var(--info)]" />} />
      </div>

      <TopMinersCard />
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="card-glass rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
      {sub && <div className="text-[10px] text-[color:var(--success)] tabular-nums">{sub}</div>}
    </div>
  );
}

function TopMinersCard() {
  const fn = useServerFn(getTopMiners);
  const { data } = useQuery({ queryKey: ["top"], queryFn: () => fn() });
  return (
    <div className="card-glass rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3"><Trophy className="w-4 h-4 text-[color:var(--gold)]" /><h3 className="font-semibold">Top miners</h3></div>
      <div className="space-y-2">
        {(data ?? []).slice(0, 5).map((m: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>
            <span className="flex-1 truncate">{m.first_name || m.username || "Anon"}</span>
            <span className="text-[color:var(--success)] tabular-nums">{formatGram(m.mining_rate)}/d</span>
          </div>
        ))}
        {!data?.length && <p className="text-sm text-muted-foreground">Be the first miner.</p>}
      </div>
    </div>
  );
}

function TasksTab() {
  const listFn = useServerFn(listTasks);
  const doFn = useServerFn(completeTask);
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(queryOptions({ queryKey: ["tasks"], queryFn: () => listFn() }));
  const mut = useMutation({
    mutationFn: (taskId: string) => doFn({ data: { taskId } }),
    onSuccess: (r) => { toast.success(`+${formatGram(r.reward)} GRAM`); getTelegram()?.HapticFeedback?.impactOccurred("light"); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold">Tasks</h2>
      <p className="text-sm text-muted-foreground">Complete tasks to earn GRAM.</p>
      <div className="space-y-2 mt-3">
        {data.map((t: any) => (
          <div key={t.id} className="card-glass rounded-2xl p-4 flex items-center gap-3">
            <div className="flex-1">
              <p className="font-semibold">{t.title}</p>
              {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
              <p className="text-xs mt-1 text-[color:var(--success)]">+{formatGram(t.reward)} GRAM</p>
            </div>
            {t.completed ? (
              <div className="flex items-center gap-1 text-[color:var(--success)] text-sm"><CheckCircle2 className="w-4 h-4" />Done</div>
            ) : (
              <button onClick={() => mut.mutate(t.id)} disabled={mut.isPending}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
                Claim
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FriendsTab() {
  const meFn = useServerFn(getMe);
  const frFn = useServerFn(getFriends);
  const { data: me } = useSuspenseQuery(meQO(() => meFn()));
  const { data: friends } = useQuery({ queryKey: ["friends"], queryFn: () => frFn() });
  const code = me.profile.referral_code as string;
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}?ref=${code}` : "";
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold">Friends</h2>
      <p className="text-sm text-muted-foreground">Invite friends and earn 10% of their mining forever.</p>
      <div className="card-glass rounded-2xl p-4">
        <p className="text-xs text-muted-foreground">Your invite link</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="text-xs flex-1 truncate">{inviteUrl}</code>
          <button onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success("Copied"); }}
            className="p-2 rounded-lg bg-primary/20 text-primary"><Copy className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="card-glass rounded-2xl p-4">
        <p className="font-semibold mb-2">Your friends ({friends?.length ?? 0})</p>
        {!friends?.length && <p className="text-sm text-muted-foreground">No referrals yet.</p>}
        {friends?.map((f: any) => (
          <div key={f.id} className="flex justify-between text-sm py-1.5">
            <span className="text-muted-foreground truncate">{f.referred_id.slice(0, 8)}…</span>
            <span className="text-[color:var(--success)]">+{formatGram(f.bonus_earned)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DepositTab() {
  const fn = useServerFn(submitDeposit);
  const listFn = useServerFn(listDeposits);
  const qc = useQueryClient();
  const [amount, setAmount] = useState("1");
  const [hash, setHash] = useState("");
  const { data: deposits } = useQuery({ queryKey: ["deposits"], queryFn: () => listFn() });
  const mut = useMutation({
    mutationFn: () => fn({ data: { amountTon: Number(amount), txHash: hash || undefined } }),
    onSuccess: () => { toast.success("Deposit submitted"); setHash(""); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold">Deposit TON</h2>
      <p className="text-sm text-muted-foreground">1 TON = +1 GRAM/day mining rate.</p>
      <div className="card-glass rounded-2xl p-4 space-y-3">
        <Field label="Amount (TON)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" /></Field>
        <Field label="Transaction hash (optional)"><input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="EQ…" className="input" /></Field>
        <button disabled={mut.isPending} onClick={() => mut.mutate()}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-accent font-semibold text-primary-foreground disabled:opacity-50">
          {mut.isPending ? "Submitting…" : "Submit deposit"}
        </button>
      </div>
      <div className="card-glass rounded-2xl p-4">
        <p className="font-semibold mb-2">History</p>
        {!deposits?.length && <p className="text-sm text-muted-foreground">No deposits yet.</p>}
        {deposits?.map((d: any) => (
          <div key={d.id} className="flex justify-between text-sm py-1.5">
            <span>{formatGram(d.amount_ton)} TON</span>
            <span className="text-muted-foreground">{d.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WithdrawTab() {
  const meFn = useServerFn(getMe);
  const wFn = useServerFn(submitWithdrawal);
  const lFn = useServerFn(listWithdrawals);
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQO(() => meFn()));
  const [amount, setAmount] = useState("100");
  const [address, setAddress] = useState("");
  const { data: hist } = useQuery({ queryKey: ["withdrawals"], queryFn: () => lFn() });
  const mut = useMutation({
    mutationFn: () => wFn({ data: { amount: Number(amount), address } }),
    onSuccess: (r) => { toast.success(`Requested. Net ${formatGram(r.net)} GRAM`); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold">Withdraw</h2>
      <p className="text-sm text-muted-foreground">Min 100 GRAM. 5% network fee.</p>
      <div className="card-glass rounded-2xl p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Available</span>
          <span className="font-semibold">{formatGram(me.profile.balance)} GRAM</span>
        </div>
        <Field label="Amount (GRAM)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" /></Field>
        <Field label="TON address"><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="UQ…" className="input" /></Field>
        <button disabled={mut.isPending} onClick={() => mut.mutate()}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-[color:var(--success)] to-accent font-semibold text-primary-foreground disabled:opacity-50 glow-success">
          {mut.isPending ? "Submitting…" : "Request withdrawal"}
        </button>
      </div>
      <div className="card-glass rounded-2xl p-4">
        <p className="font-semibold mb-2">History</p>
        {!hist?.length && <p className="text-sm text-muted-foreground">No withdrawals yet.</p>}
        {hist?.map((w: any) => (
          <div key={w.id} className="flex justify-between text-sm py-1.5">
            <span>{formatGram(w.amount)} GRAM</span>
            <span className="text-muted-foreground">{w.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "mine", label: "Mine", icon: <Pickaxe className="w-5 h-5" /> },
    { id: "tasks", label: "Tasks", icon: <ListChecks className="w-5 h-5" /> },
    { id: "friends", label: "Friends", icon: <Users className="w-5 h-5" /> },
    { id: "deposit", label: "Deposit", icon: <ArrowDownToLine className="w-5 h-5" /> },
    { id: "withdraw", label: "Cash", icon: <ArrowUpFromLine className="w-5 h-5" /> },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40">
      <div className="max-w-md mx-auto px-3 pb-3">
        <div className="card-glass rounded-2xl px-2 py-2 flex justify-between">
          {items.map((it) => {
            const active = tab === it.id;
            return (
              <button key={it.id} onClick={() => { setTab(it.id); getTelegram()?.HapticFeedback?.impactOccurred("light"); }}
                className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition ${active ? "text-primary" : "text-muted-foreground"}`}>
                <div className={`p-1.5 rounded-lg ${active ? "bg-primary/15" : ""}`}>{it.icon}</div>
                <span className="text-[10px] font-medium">{it.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
