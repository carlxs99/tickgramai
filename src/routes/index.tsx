import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { Pickaxe, ListChecks, Users, ArrowDownToLine, ArrowUpFromLine, Sparkles, Copy, CheckCircle2, Coins, Trophy, Loader2, Wallet, Shield, Plus, Trash2, Pencil } from "lucide-react";
import { toast, Toaster } from "sonner";
import { TonConnectUIProvider, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";

import { authWithTelegram } from "@/lib/telegram-auth.functions";
import { getMe, collectIncome, listTasks, completeTask, submitDeposit, listDeposits, submitWithdrawal, listWithdrawals, getTopMiners, getFriends, saveWallet } from "@/lib/miner.functions";
import { adminStats, adminListTasks, adminSaveTask, adminDeleteTask } from "@/lib/admin.functions";
import { getTonPrice } from "@/lib/prices.functions";
import { getTelegram, restoreSession } from "@/lib/telegram";
import { formatGram } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";

const RECEIVING_WALLET = "UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn";

export const Route = createFileRoute("/")({
  ssr: false,
  component: MinerApp,
});

type Tab = "mine" | "tasks" | "top" | "friends" | "deposit" | "withdraw" | "admin";

function MinerApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("mine");
  const authFn = useServerFn(authWithTelegram);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    (async () => {
      try {
        // Wait up to ~3s for the Telegram WebApp SDK to be injected.
        let tg = getTelegram();
        const start = Date.now();
        while (!tg?.initData && Date.now() - start < 3000) {
          await new Promise((r) => setTimeout(r, 100));
          tg = getTelegram();
        }
        tg?.ready();
        tg?.expand();

        const initData = tg?.initData && tg.initData.length > 0 ? tg.initData : undefined;
        const insideTelegram = typeof window !== "undefined" && !!window.Telegram?.WebApp;

        const { data: existing } = await supabase.auth.getSession();

        // If we have real Telegram initData, ALWAYS re-authenticate so the
        // profile gets refreshed with the real name/username/avatar — even
        // if a stale (demo) session already exists in localStorage.
        if (initData) {
          if (existing.session) await supabase.auth.signOut();
          const tokens = await authFn({ data: { initData } });
          await restoreSession(tokens);
          setReady(true);
          return;
        }

        // No real initData. Reuse existing session if present.
        if (existing.session) { setReady(true); return; }

        // Outside Telegram (dev/browser) → demo. Inside Telegram without
        // initData → the Mini App was opened without a WebApp button.
        if (insideTelegram) {
          setError(
            "Telegram no envió tu identidad. Abre la Mini App desde el botón del menú del bot (@Tickgramaibot) o desde t.me/Tickgramaibot/app."
          );
          return;
        }

        const demoId = Math.floor(1_000_000 + Math.random() * 9_000_000);
        const tokens = await authFn({ data: { demoId } });
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

  const manifestUrl = typeof window !== "undefined"
    ? `${window.location.origin}/tonconnect-manifest.json`
    : "https://ton-connect.github.io/demo-dapp-with-react-ui/tonconnect-manifest.json";

  // Deep-link back to this Mini App after the wallet signs the tx.
  // Bot has Main Mini App → t.me/<bot> opens it directly.
  const twaReturnUrl = "https://t.me/Tickgramaibot" as `${string}://${string}`;

  return (
    <TonConnectUIProvider
      manifestUrl={manifestUrl}
      actionsConfiguration={{ twaReturnUrl }}
      uiPreferences={{ theme: "DARK" as any }}
    >
      <div className="min-h-screen pb-24 max-w-md mx-auto">
        <Toaster theme="dark" position="top-center" richColors />
        <Header onAdminClick={() => setTab("admin")} />
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
            {tab === "top" && <LeaderboardTab />}
            {tab === "friends" && <FriendsTab />}
            {tab === "deposit" && <DepositTab />}
            {tab === "withdraw" && <WithdrawTab />}
            {tab === "admin" && <AdminTab />}
          </motion.main>
        </AnimatePresence>
        <BottomNav tab={tab} setTab={setTab} />
      </div>
    </TonConnectUIProvider>
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
              : "Deposit GRAM to start mining"}
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
        <StatCard label="Deposits" value={formatGram(data.profile.deposit_total) + " GRAM"} sub={`1 GRAM ≈ $${price.toFixed(2)}`} icon={<ArrowDownToLine className="w-4 h-4 text-[color:var(--info)]" />} />
      </div>

      
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

function podiumInitial(m: any) {
  return (m?.first_name || m?.username || "A").slice(0, 1).toUpperCase();
}

function PodiumSlot({ miner, rank }: { miner: any | undefined; rank: 1 | 2 | 3 }) {
  const styles = {
    1: {
      order: "order-2",
      ring: "ring-4 ring-[color:var(--gold)]",
      badge: "bg-[color:var(--gold)] text-black",
      bar: "bg-gradient-to-b from-[color:var(--gold)] to-amber-500",
      height: "h-32",
      avatar: "w-20 h-20 text-2xl",
      crown: true,
    },
    2: {
      order: "order-1",
      ring: "ring-2 ring-slate-300/70",
      badge: "bg-slate-300 text-black",
      bar: "bg-gradient-to-b from-slate-300 to-slate-500",
      height: "h-24",
      avatar: "w-16 h-16 text-xl",
      crown: false,
    },
    3: {
      order: "order-3",
      ring: "ring-2 ring-orange-400/80",
      badge: "bg-orange-400 text-black",
      bar: "bg-gradient-to-b from-orange-400 to-orange-600",
      height: "h-20",
      avatar: "w-16 h-16 text-xl",
      crown: false,
    },
  }[rank];
  const name = miner ? (miner.first_name || miner.username || "Anon") : "—";
  const rate = miner ? formatGram(miner.mining_rate) : "—";
  return (
    <div className={`flex-1 flex flex-col items-center ${styles.order}`}>
      <div className="relative">
        {styles.crown && (
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-2xl select-none">👑</div>
        )}
        <div className={`${styles.avatar} rounded-full bg-gradient-to-br from-primary/60 to-accent/60 ${styles.ring} flex items-center justify-center font-bold text-primary-foreground overflow-hidden`}>
          {miner?.avatar_url ? (
            <img src={miner.avatar_url} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span>{podiumInitial(miner)}</span>
          )}
        </div>
        <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full ${styles.badge} text-xs font-bold flex items-center justify-center ring-2 ring-background`}>
          {rank}
        </div>
      </div>
      <p className="mt-2 text-xs font-semibold text-center truncate max-w-[90%]">{name}</p>
      <p className="text-[10px] text-muted-foreground">{rate}/d</p>
      <div className={`mt-2 w-full ${styles.height} ${styles.bar} rounded-t-2xl relative overflow-hidden`}>
        <div className="absolute inset-x-0 top-2 text-center">
          <div className="text-base font-extrabold text-black/90 drop-shadow">{rate}</div>
          <div className="text-[9px] font-semibold text-black/70 tracking-wider">GRAM/d</div>
        </div>
      </div>
    </div>
  );
}

function LeaderboardTab() {
  const fn = useServerFn(getTopMiners);
  const price = useTonPrice();
  const { data } = useQuery({ queryKey: ["top"], queryFn: () => fn(), refetchInterval: 30_000 });
  const list = (data ?? []) as any[];
  const top3 = [list[0], list[1], list[2]];
  const rest = list.slice(3, 10);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Leaderboard</h2>
        <p className="text-xs text-muted-foreground">Top miners by GRAM mined per day.</p>
      </div>

      <div className="card-glass rounded-3xl p-4 overflow-hidden relative">
        <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ background: "radial-gradient(600px 200px at 50% -20%, color-mix(in oklab, var(--gold) 30%, transparent), transparent)" }} />
        <div className="flex items-center justify-between mb-4 relative">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[color:var(--gold)]" />
            <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Live ranking</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--success)]/15 text-[color:var(--success)] font-semibold">ACTIVE</span>
        </div>
        <div className="flex items-end gap-2 relative">
          <PodiumSlot miner={top3[1]} rank={2} />
          <PodiumSlot miner={top3[0]} rank={1} />
          <PodiumSlot miner={top3[2]} rank={3} />
        </div>
      </div>

      <div className="card-glass rounded-2xl p-2">
        {rest.length === 0 && list.length <= 3 ? (
          <p className="p-4 text-sm text-muted-foreground text-center">Only the podium is set — invite miners to fill the ranks.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {rest.map((m, i) => {
              const rank = i + 4;
              const name = m.first_name || m.username || "Anon";
              return (
                <div key={rank} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-6 text-center text-xs font-bold text-muted-foreground">#{rank}</span>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 flex items-center justify-center text-sm font-bold overflow-hidden">
                    {m.avatar_url ? <img src={m.avatar_url} alt={name} className="w-full h-full object-cover" /> : podiumInitial(m)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{name}</p>
                    <p className="text-[10px] text-muted-foreground">≈ ${usdt(Number(m.mining_rate), price)}/d</p>
                  </div>
                  <span className="text-sm tabular-nums text-[color:var(--success)] font-semibold">{formatGram(m.mining_rate)}/d</span>
                </div>
              );
            })}
          </div>
        )}
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
  const inviteUrl = `https://t.me/Tickgramaibot/app?startapp=${code}`;
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
  const listFn = useServerFn(listDeposits);
  const meFn = useServerFn(getMe);
  const saveWalletFn = useServerFn(saveWallet);
  const qc = useQueryClient();
  const price = useTonPrice();
  const { data: me } = useSuspenseQuery(meQO(() => meFn()));

  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [amount, setAmount] = useState("");
  const { data: deposits } = useQuery({ queryKey: ["deposits"], queryFn: () => listFn() });

  const amountNum = Math.max(0, Number(amount) || 0);
  const usdtValue = amountNum * price;
  const memoTag: string = (me.profile as any).memo_tag ?? "";

  // Persist wallet address whenever it changes
  useEffect(() => {
    const addr = wallet?.account?.address ?? null;
    const saved = (me.profile as any).wallet_address ?? null;
    if (addr !== saved) {
      saveWalletFn({ data: { address: addr } }).catch(() => {});
    }
  }, [wallet?.account?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = useMutation({
    mutationFn: async () => {
      if (!wallet) throw new Error("Connect your wallet first");
      if (amountNum <= 0) throw new Error("Enter an amount");
      if (!memoTag) throw new Error("Missing memo");

      // Build a text-comment payload (op=0, memo string) as base64 BOC-like cell.
      // TonConnect accepts the classic { address, amount, payload? } shape.
      // A memo/comment payload is a cell: 32-bit op=0 + utf-8 string, serialized.
      const memoPayload = buildCommentPayload(memoTag);
      const nano = Math.floor(amountNum * 1e9).toString();

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: RECEIVING_WALLET, amount: nano, payload: memoPayload }],
      });
    },
    onSuccess: () => {
      toast.success("Transaction sent. It will be credited automatically once confirmed on-chain.");
      setAmount("");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Transaction failed"),
  });

  return (
    <div className="space-y-3 pb-2">
      <h2 className="text-2xl font-bold">Deposit</h2>
      <p className="text-sm text-muted-foreground">
        Connect your GRAM wallet and pay directly. Your unique memo is added automatically so we can detect your deposit.
      </p>

      <div className="card-glass rounded-2xl p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Your balance</span>
          <span className="font-semibold">{formatGram(me.profile.balance)} GRAM</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Current rate</span>
          <span className="font-semibold">{formatGram(me.profile.mining_rate)} GRAM/day</span>
        </div>
        <div className="flex justify-between text-sm items-center">
          <span className="text-muted-foreground">Your memo</span>
          <button
            onClick={() => { navigator.clipboard.writeText(memoTag); toast.success("Memo copied"); }}
            className="flex items-center gap-1.5 font-mono font-semibold text-primary"
          >
            {memoTag} <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="card-glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">GRAM Wallet</span>
          </div>
          {wallet ? (
            <button
              onClick={() => tonConnectUI.disconnect()}
              className="text-xs text-muted-foreground underline"
            >
              Disconnect
            </button>
          ) : null}
        </div>
        {wallet ? (
          <p className="text-xs text-muted-foreground font-mono break-all">
            {wallet.account.address}
          </p>
        ) : (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => tonConnectUI.openModal()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-primary via-accent to-primary font-bold text-primary-foreground"
          >
            Connect Wallet
          </motion.button>
        )}
      </div>

      <Field label="Amount (GRAM)">
        <div className="relative">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="input pr-16 text-lg font-semibold"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">GRAM</span>
        </div>
        {amountNum > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
            ≈ ${usdtValue.toFixed(2)} USDT · earns {(amountNum * 0.033).toFixed(4)} GRAM/day
          </p>
        )}
      </Field>

      <motion.button
        whileTap={{ scale: 0.97 }}
        disabled={pay.isPending || amountNum <= 0 || !wallet}
        onClick={() => pay.mutate()}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary via-accent to-primary font-bold text-primary-foreground disabled:opacity-50 shadow-xl glow-primary"
      >
        {pay.isPending ? "Waiting for wallet…" : wallet ? "Pay & start earning" : "Connect wallet to deposit"}
      </motion.button>

      {!!deposits?.length && (
        <div className="card-glass rounded-2xl p-4">
          <p className="font-semibold mb-2">History</p>
          {deposits.map((d: any) => (
            <div key={d.id} className="flex justify-between text-sm py-1.5">
              <span>{Number(d.amount_ton).toFixed(4)} GRAM</span>
              <span className="text-muted-foreground">{d.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Build a TonConnect payload cell containing a text comment (op=0 + utf-8 memo).
// Uses @ton/core-style CRC serialization via a minimal handcrafted BOC.
// For text comments TonConnect requires a base64 BOC of a Cell with:
//   [uint32 op=0][string bytes...]
function buildCommentPayload(memo: string): string {
  // op=0 (4 bytes) + utf-8 memo
  const memoBytes = new TextEncoder().encode(memo);
  const data = new Uint8Array(4 + memoBytes.length);
  // op = 0 already zero
  data.set(memoBytes, 4);

  // Minimal BOC with a single cell containing `data` bits.
  const bits = data.length * 8;
  const dataLen = data.length;

  // Cell descriptor
  const d1 = 0; // refs=0, no exotic
  // d2: floor(bits/8)*2 + ceil(bits/8) but for full bytes it's dataLen*2
  const fullBytes = Math.floor(bits / 8);
  const rem = bits % 8;
  const d2 = fullBytes * 2 + (rem > 0 ? 1 : 0);

  const cell = new Uint8Array(2 + dataLen);
  cell[0] = d1;
  cell[1] = d2;
  cell.set(data, 2);

  // BOC header (single root, no index, no crc)
  //   magic (4)  = b5ee9c72
  //   flags (1)  = 0 (has_idx=0, has_crc=0, has_cache_bits=0, flags=0, size_bytes=1)
  //   off_bytes  = 1
  //   cells (1)  = 1
  //   roots (1)  = 1
  //   absent (1) = 0
  //   tot_cells_size (1) = cell.length
  //   root_list (1 byte) = 0
  //   cells data
  const header = new Uint8Array([
    0xb5, 0xee, 0x9c, 0x72,
    0x01, // has_idx=0, has_crc=0, size_bytes=1
    0x01, // off_bytes=1
    0x01, // cells=1
    0x01, // roots=1
    0x00, // absent=0
    cell.length & 0xff,
    0x00, // root index
  ]);
  const boc = new Uint8Array(header.length + cell.length);
  boc.set(header, 0);
  boc.set(cell, header.length);

  // base64
  let bin = "";
  for (let i = 0; i < boc.length; i++) bin += String.fromCharCode(boc[i]);
  return btoa(bin);
}


function Row({ k, v, strong, muted }: { k: string; v: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={muted ? "text-muted-foreground text-xs" : "text-muted-foreground"}>{k}</span>
      <span className={`tabular-nums ${strong ? "font-bold" : ""} ${muted ? "text-muted-foreground text-xs" : ""}`}>{v}</span>
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
        <Field label="GRAM address"><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="UQ…" className="input" /></Field>
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
    { id: "top", label: "Top", icon: <Trophy className="w-5 h-5" /> },
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
