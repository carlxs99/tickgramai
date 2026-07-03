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
import { LanguageProvider, LanguageSwitcher, useT } from "@/i18n";


const RECEIVING_WALLET = "UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn";

export const Route = createFileRoute("/")({
  ssr: false,
  component: MinerApp,
});

type Tab = "mine" | "tasks" | "top" | "friends" | "deposit" | "withdraw" | "admin";

function MinerApp() {
  return (
    <LanguageProvider>
      <MinerAppInner />
    </LanguageProvider>
  );
}

function MinerAppInner() {
  const { t } = useT();
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
          setError(t("auth.telegram_no_identity"));
          return;
        }

        const demoId = Math.floor(1_000_000 + Math.random() * 9_000_000);
        const tokens = await authFn({ data: { demoId } });
        await restoreSession(tokens);
        setReady(true);
      } catch (e: any) {
        setError(e?.message ?? t("auth.failed"));
      }
    })();
  }, [authFn, t]);

  if (error) {
    return (
      <Center>
        <div className="text-center">
          <p className="text-destructive font-medium">{t("auth.error")}</p>
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
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
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

function Header({ onAdminClick }: { onAdminClick: () => void }) {
  const { t } = useT();
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
          <p className="text-xs text-muted-foreground">{t("header.welcome")}</p>
          <p className="font-semibold truncate">{name}</p>
        </div>
        <LanguageSwitcher />
        {data?.isAdmin && (
          <button
            onClick={onAdminClick}
            className="p-2 rounded-xl card-glass text-primary"
            aria-label={t("header.admin_panel")}
          >
            <Shield className="w-4 h-4" />
          </button>
        )}
        <div className="flex flex-col items-end gap-0.5 px-3 py-1.5 rounded-2xl card-glass">
          <div className="flex items-center gap-1">
            <Coins className="w-3.5 h-3.5 text-[color:var(--gold)]" />
            <span className="font-semibold text-sm tabular-nums">{formatGram(bal, 6)}</span>
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
  const { t } = useT();
  const meFn = useServerFn(getMe);
  const collectFn = useServerFn(collectIncome);
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(meQO(() => meFn()));
  const [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((tk) => tk + 1), 100); return () => clearInterval(i); }, []);

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
      toast.success(`+${formatGram(r.gained, 4)} GRAM ${t("mine.collected_toast")}`);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? t("common.failed")),
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
            <Sparkles className="w-3.5 h-3.5" /> {t("mine.uncollected")}
          </div>
          <div className="mt-2 text-5xl font-extrabold tabular-nums">
            {formatGram(live, 6)}
          </div>
          <div className="text-xs text-[color:var(--success)] tabular-nums mt-0.5">
            ≈ ${usdt(live, price)} USDT
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {rate > 0
              ? <>{formatGram(rate, 2)} {t("mine.per_day")} <span className="text-[color:var(--success)]">(≈ ${usdt(rate, price)} {t("mine.per_day_suffix")})</span></>
              : t("mine.deposit_to_start")}
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => collect.mutate()}
            disabled={collect.isPending || live < 0.0001}
            className="mt-5 w-full py-4 rounded-2xl bg-gradient-to-r from-primary to-accent font-bold text-primary-foreground disabled:opacity-50 shadow-lg"
          >
            {collect.isPending ? t("mine.collecting") : t("mine.collect")}
          </motion.button>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t("mine.balance")} value={formatGram(data.profile.balance, 6)} sub={`≈ $${usdt(Number(data.profile.balance), price)}`} icon={<Coins className="w-4 h-4 text-[color:var(--gold)]" />} />
        <StatCard label={t("mine.deposits")} value={formatGram(data.profile.deposit_total) + " GRAM"} sub={t("mine.gram_price", { price: price.toFixed(2) })} icon={<ArrowDownToLine className="w-4 h-4 text-[color:var(--info)]" />} />
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
  const { t } = useT();
  const name = miner ? (miner.first_name || miner.username || t("leaderboard.anon")) : "—";
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
  const { t } = useT();
  const fn = useServerFn(getTopMiners);
  const price = useTonPrice();
  const { data } = useQuery({ queryKey: ["top"], queryFn: () => fn(), refetchInterval: 30_000 });
  const list = (data ?? []) as any[];
  const top3 = [list[0], list[1], list[2]];
  const rest = list.slice(3, 10);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">{t("leaderboard.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("leaderboard.subtitle")}</p>
      </div>

      <div className="card-glass rounded-3xl p-4 overflow-hidden relative">
        <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ background: "radial-gradient(600px 200px at 50% -20%, color-mix(in oklab, var(--gold) 30%, transparent), transparent)" }} />
        <div className="flex items-center justify-between mb-4 relative">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[color:var(--gold)]" />
            <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">{t("leaderboard.live_ranking")}</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--success)]/15 text-[color:var(--success)] font-semibold">{t("leaderboard.active")}</span>
        </div>
        <div className="flex items-end gap-2 relative">
          <PodiumSlot miner={top3[1]} rank={2} />
          <PodiumSlot miner={top3[0]} rank={1} />
          <PodiumSlot miner={top3[2]} rank={3} />
        </div>
      </div>

      <div className="card-glass rounded-2xl p-2">
        {rest.length === 0 && list.length <= 3 ? (
          <p className="p-4 text-sm text-muted-foreground text-center">{t("leaderboard.only_podium")}</p>
        ) : (
          <div className="divide-y divide-white/5">
            {rest.map((m, i) => {
              const rank = i + 4;
              const name = m.first_name || m.username || t("leaderboard.anon");
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
  const { t: tr } = useT();
  const listFn = useServerFn(listTasks);
  const doFn = useServerFn(completeTask);
  const meFn = useServerFn(getMe);
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(queryOptions({ queryKey: ["tasks"], queryFn: () => listFn() }));
  const { data: me } = useSuspenseQuery(meQO(() => meFn()));
  const [shared, setShared] = useState<Record<string, boolean>>({});
  const code = me.profile.referral_code as string;
  const inviteUrl = `https://t.me/Tickgramaibot/app?startapp=${code}`;
  const mut = useMutation({
    mutationFn: (taskId: string) => doFn({ data: { taskId } }),
    onSuccess: (r) => { toast.success(`+${formatGram(r.reward)} GRAM`); getTelegram()?.HapticFeedback?.impactOccurred("light"); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e?.message ?? tr("common.failed")),
  });
  const isShareTask = (t: any) => {
    const s = `${t.title ?? ""} ${t.description ?? ""}`.toLowerCase();
    return /share|invita|invite|friend|amig|refer/.test(s);
  };
  const openShare = (t: any) => {
    const text = t.description || tr("tasks.share_default");
    const url = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(text)}`;
    const tg: any = getTelegram();
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
    setShared((s) => ({ ...s, [t.id]: true }));
  };
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold">{tr("tasks.title")}</h2>
      <p className="text-sm text-muted-foreground">{tr("tasks.subtitle")}</p>
      <div className="space-y-2 mt-3">
        {data.map((t: any) => {
          const share = isShareTask(t);
          const hasShared = shared[t.id];
          return (
          <div key={t.id} className="card-glass rounded-2xl p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{t.title}</p>
              {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
              <p className="text-xs mt-1 text-[color:var(--success)]">+{formatGram(t.reward)} GRAM</p>
            </div>
            {t.completed ? (
              <div className="flex items-center gap-1 text-[color:var(--success)] text-sm"><CheckCircle2 className="w-4 h-4" />{tr("tasks.done")}</div>
            ) : (
              <div className="flex flex-col gap-1">
                {(t.kind === "channel" || t.kind === "group") && t.link && (
                  <a href={t.link} target="_blank" rel="noreferrer"
                    className="px-3 py-1.5 rounded-xl card-glass text-xs font-semibold text-center">
                    {tr("tasks.join")}
                  </a>
                )}
                {share && !hasShared ? (
                  <button onClick={() => openShare(t)}
                    className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
                    {tr("tasks.share")}
                  </button>
                ) : (
                  <button onClick={() => mut.mutate(t.id)}
                    disabled={mut.isPending || (share && !hasShared)}
                    className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
                    {t.kind === "channel" || t.kind === "group" ? tr("tasks.verify") : tr("tasks.claim")}
                  </button>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}


function FriendsTab() {
  const { t } = useT();
  const meFn = useServerFn(getMe);
  const frFn = useServerFn(getFriends);
  const { data: me } = useSuspenseQuery(meQO(() => meFn()));
  const { data: friends } = useQuery({ queryKey: ["friends"], queryFn: () => frFn() });
  const code = me.profile.referral_code as string;
  const inviteUrl = `https://t.me/Tickgramaibot/app?startapp=${code}`;
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const list = friends ?? [];
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold">{t("friends.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("friends.subtitle")}</p>
      <div className="card-glass rounded-2xl p-4">
        <p className="text-xs text-muted-foreground">{t("friends.your_invite")}</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="text-xs flex-1 truncate">{inviteUrl}</code>
          <button onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success(t("common.copied")); }}
            className="p-2 rounded-lg bg-primary/20 text-primary"><Copy className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="card-glass rounded-2xl p-4">
        <p className="font-semibold mb-2">{t("friends.your_friends", { count: list.length })}</p>
        {list.length === 0 && <p className="text-sm text-muted-foreground">{t("friends.no_referrals")}</p>}
        <div className="space-y-2">
          {pageItems.map((f: any) => {
            const p = f.profile;
            const name = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || `${String(f.referred_id).slice(0, 8)}…` : `${String(f.referred_id).slice(0, 8)}…`;
            const initial = (name?.[0] ?? "?").toUpperCase();
            return (
              <div key={f.id} className="flex items-center gap-3 py-1.5">
                {p?.avatar_url ? (
                  <img src={p.avatar_url} alt={name} className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-semibold">{initial}</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{name}</p>
                  {p?.username && <p className="text-xs text-muted-foreground truncate">@{p.username}</p>}
                </div>
                <span className="text-sm text-[color:var(--success)]">+{formatGram(f.bonus_earned)}</span>
              </div>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-sm disabled:opacity-40"
            >‹</button>
            <span className="text-xs text-muted-foreground">{currentPage}/{totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-sm disabled:opacity-40"
            >›</button>
          </div>
        )}
      </div>
    </div>
  );
}

function DepositTab() {
  const { t } = useT();
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

  useEffect(() => {
    const addr = wallet?.account?.address ?? null;
    const saved = (me.profile as any).wallet_address ?? null;
    if (addr !== saved) {
      saveWalletFn({ data: { address: addr } }).catch(() => {});
    }
  }, [wallet?.account?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = useMutation({
    mutationFn: async () => {
      if (!wallet) throw new Error(t("deposit.err_connect"));
      if (amountNum <= 0) throw new Error(t("deposit.err_amount"));
      if (!memoTag) throw new Error(t("deposit.err_memo"));

      const memoPayload = buildCommentPayload(memoTag);
      const nano = Math.floor(amountNum * 1e9).toString();

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: RECEIVING_WALLET, amount: nano, payload: memoPayload }],
      });
    },
    onSuccess: () => {
      toast.success(t("deposit.tx_sent"));
      setAmount("");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? t("deposit.err_failed")),
  });

  return (
    <div className="space-y-3 pb-2">
      <h2 className="text-2xl font-bold">{t("deposit.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("deposit.subtitle")}</p>

      <div className="card-glass rounded-2xl p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("deposit.your_balance")}</span>
          <span className="font-semibold tabular-nums">{formatGram(me.profile.balance, 6)} GRAM</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("deposit.current_rate")}</span>
          <span className="font-semibold">{formatGram(me.profile.mining_rate)} {t("mine.per_day")}</span>
        </div>
        <div className="flex justify-between text-sm items-center">
          <span className="text-muted-foreground">{t("deposit.your_memo")}</span>
          <button
            onClick={() => { navigator.clipboard.writeText(memoTag); toast.success(t("deposit.memo_copied")); }}
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
            <span className="font-semibold text-sm">{t("deposit.wallet")}</span>
          </div>
          {wallet ? (
            <button
              onClick={() => tonConnectUI.disconnect()}
              className="text-xs text-muted-foreground underline"
            >
              {t("common.disconnect")}
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
            {t("deposit.connect_wallet")}
          </motion.button>
        )}
      </div>

      <Field label={t("deposit.amount")}>
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
            {t("deposit.amount_helper", { usdt: usdtValue.toFixed(2), daily: (amountNum * 0.033).toFixed(4) })}
          </p>
        )}
      </Field>

      <motion.button
        whileTap={{ scale: 0.97 }}
        disabled={pay.isPending || amountNum <= 0 || !wallet}
        onClick={() => pay.mutate()}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary via-accent to-primary font-bold text-primary-foreground disabled:opacity-50 shadow-xl glow-primary"
      >
        {pay.isPending ? t("deposit.waiting") : wallet ? t("deposit.pay") : t("deposit.connect_to_deposit")}
      </motion.button>

      {!!deposits?.length && (
        <div className="card-glass rounded-2xl p-4">
          <p className="font-semibold mb-2">{t("common.history")}</p>
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
  const { t } = useT();
  const meFn = useServerFn(getMe);
  const wFn = useServerFn(submitWithdrawal);
  const lFn = useServerFn(listWithdrawals);
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQO(() => meFn()));
  const [amount, setAmount] = useState("1");
  const [address, setAddress] = useState("");
  const { data: hist } = useQuery({ queryKey: ["withdrawals"], queryFn: () => lFn() });
  const amountNum = Number(amount);
  const amountInvalid = isNaN(amountNum) || amountNum < 1;
  const mut = useMutation({
    mutationFn: () => {
      if (amountInvalid) throw new Error(t("withdraw.min_error"));
      if (!address.trim()) throw new Error(t("withdraw.address"));
      return wFn({ data: { amount: amountNum, address } });
    },
    onSuccess: (r) => { toast.success(t("withdraw.requested_net", { amount: formatGram(r.net) })); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e?.message ?? t("common.failed")),
  });
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold">{t("withdraw.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("withdraw.subtitle")}</p>
      <div className="card-glass rounded-2xl p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("withdraw.available")}</span>
          <span className="font-semibold tabular-nums">{formatGram(me.profile.balance, 6)} GRAM</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("withdraw.min_label")}</span>
          <span className="font-semibold">1 GRAM</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("withdraw.fee_label")}</span>
          <span className="font-semibold">5%</span>
        </div>
        <Field label={t("withdraw.amount")}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          {amountInvalid && <p className="text-[10px] text-destructive mt-1">{t("withdraw.min_error")}</p>}
        </Field>
        <Field label={t("withdraw.address")}><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="UQ…" className="input" /></Field>
        {!amountInvalid && (
          <div className="flex justify-between text-sm pt-1 border-t border-white/5">
            <span className="text-muted-foreground">{t("withdraw.net_label")}</span>
            <span className="font-semibold text-[color:var(--success)]">{formatGram(amountNum * 0.95)} GRAM</span>
          </div>
        )}
        <button disabled={mut.isPending || amountInvalid || !address.trim()} onClick={() => mut.mutate()}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-[color:var(--success)] to-accent font-semibold text-primary-foreground disabled:opacity-50 glow-success">
          {mut.isPending ? t("withdraw.submitting") : t("withdraw.request")}
        </button>
      </div>
      <div className="card-glass rounded-2xl p-4">
        <p className="font-semibold mb-2">{t("common.history")}</p>
        {!hist?.length && <p className="text-sm text-muted-foreground">{t("withdraw.none")}</p>}
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
  const { t } = useT();
  const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "mine", label: t("nav.mine"), icon: <Pickaxe className="w-5 h-5" /> },
    { id: "tasks", label: t("nav.tasks"), icon: <ListChecks className="w-5 h-5" /> },
    { id: "top", label: t("nav.top"), icon: <Trophy className="w-5 h-5" /> },
    { id: "friends", label: t("nav.friends"), icon: <Users className="w-5 h-5" /> },
    { id: "deposit", label: t("nav.deposit"), icon: <ArrowDownToLine className="w-5 h-5" /> },
    { id: "withdraw", label: t("nav.cash"), icon: <ArrowUpFromLine className="w-5 h-5" /> },
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


function AdminTab() {
  const { t: tr } = useT();
  const statsFn = useServerFn(adminStats);
  const listFn = useServerFn(adminListTasks);
  const saveFn = useServerFn(adminSaveTask);
  const delFn = useServerFn(adminDeleteTask);
  const qc = useQueryClient();

  const { data: stats } = useQuery({ queryKey: ["admin-stats"], queryFn: () => statsFn(), refetchInterval: 20_000 });
  const { data: tasks } = useQuery({ queryKey: ["admin-tasks"], queryFn: () => listFn() });

  const empty = {
    id: undefined as string | undefined,
    code: "",
    title: "",
    description: "",
    reward: 0.1,
    kind: "daily" as "daily" | "once" | "channel" | "group",
    min_deposit: 0,
    link: "",
    target_chat: "",
    is_active: true,
  };
  const [form, setForm] = useState(empty);
  const editing = !!form.id;

  const save = useMutation({
    mutationFn: () => saveFn({
      data: {
        id: form.id,
        code: form.code.trim(),
        title: form.title.trim(),
        description: form.description?.trim() || null,
        reward: Number(form.reward) || 0,
        kind: form.kind,
        min_deposit: Number(form.min_deposit) || 0,
        link: form.link?.trim() || null,
        target_chat: form.target_chat?.trim() || null,
        is_active: form.is_active,
      },
    }),
    onSuccess: () => {
      toast.success(editing ? tr("admin.task_updated") : tr("admin.task_created"));
      setForm(empty);
      qc.invalidateQueries({ queryKey: ["admin-tasks"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? tr("common.error")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success(tr("admin.deleted"));
      qc.invalidateQueries({ queryKey: ["admin-tasks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? tr("common.error")),
  });

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-primary" />
        <h2 className="text-2xl font-bold">{tr("admin.title")}</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={tr("admin.users")} value={String(stats?.users ?? 0)} sub={tr("admin.tasks_today", { n: stats?.completedToday ?? 0 })} icon={<Users className="w-4 h-4 text-primary" />} />
        <StatCard label={tr("admin.deposits")} value={`${(stats?.deposits.totalTon ?? 0).toFixed(2)} TON`} sub={tr("admin.confirmed", { n: stats?.deposits.confirmed ?? 0 })} icon={<ArrowDownToLine className="w-4 h-4 text-[color:var(--info)]" />} />
        <StatCard label={tr("admin.withdrawals")} value={`${formatGram(stats?.withdrawals.totalGram ?? 0)}`} sub={tr("admin.pending", { n: stats?.withdrawals.pending ?? 0 })} icon={<ArrowUpFromLine className="w-4 h-4 text-[color:var(--gold)]" />} />
        <StatCard label={tr("admin.mining_rate")} value={`${formatGram(stats?.totals.miningRate ?? 0)}/d`} sub={tr("admin.balances", { n: formatGram(stats?.totals.balance ?? 0) })} icon={<Sparkles className="w-4 h-4 text-accent" />} />
      </div>

      <div className="card-glass rounded-2xl p-4 space-y-2">
        <p className="font-semibold flex items-center gap-2">
          {editing ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {editing ? tr("admin.edit_task") : tr("admin.new_task")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input className="col-span-2 bg-background/60 rounded-xl px-3 py-2 text-sm border border-white/5"
            placeholder={tr("admin.title_ph")} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="bg-background/60 rounded-xl px-3 py-2 text-sm border border-white/5"
            placeholder={tr("admin.code_ph")} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <select className="bg-background/60 rounded-xl px-3 py-2 text-sm border border-white/5"
            value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as any })}>
            <option value="daily">{tr("admin.kind.daily")}</option>
            <option value="once">{tr("admin.kind.once")}</option>
            <option value="channel">{tr("admin.kind.channel")}</option>
            <option value="group">{tr("admin.kind.group")}</option>
          </select>
          <input className="bg-background/60 rounded-xl px-3 py-2 text-sm border border-white/5"
            type="number" step="0.01" placeholder={tr("admin.reward_ph")}
            value={form.reward} onChange={(e) => setForm({ ...form, reward: Number(e.target.value) })} />
          <input className="bg-background/60 rounded-xl px-3 py-2 text-sm border border-white/5"
            type="number" step="0.01" placeholder={tr("admin.min_deposit_ph")}
            value={form.min_deposit} onChange={(e) => setForm({ ...form, min_deposit: Number(e.target.value) })} />
          <input className="col-span-2 bg-background/60 rounded-xl px-3 py-2 text-sm border border-white/5"
            placeholder={tr("admin.desc_ph")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {(form.kind === "channel" || form.kind === "group") && (
            <>
              <input className="col-span-2 bg-background/60 rounded-xl px-3 py-2 text-sm border border-white/5"
                placeholder={tr("admin.target_chat_ph")}
                value={form.target_chat} onChange={(e) => setForm({ ...form, target_chat: e.target.value })} />
              <input className="col-span-2 bg-background/60 rounded-xl px-3 py-2 text-sm border border-white/5"
                placeholder={tr("admin.link_ph")}
                value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
            </>
          )}
          <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            {tr("admin.active")}
          </label>
        </div>
        {(form.kind === "channel" || form.kind === "group") && (
          <p className="text-[11px] text-muted-foreground">{tr("admin.bot_note")}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.title || !form.code}
            className="flex-1 py-2 rounded-xl bg-gradient-to-r from-primary to-accent font-semibold text-primary-foreground text-sm disabled:opacity-50"
          >
            {save.isPending ? tr("admin.saving") : editing ? tr("admin.save_changes") : tr("admin.create_task")}
          </button>
          {editing && (
            <button onClick={() => setForm(empty)} className="px-3 py-2 rounded-xl card-glass text-sm">
              {tr("common.cancel")}
            </button>
          )}
        </div>
      </div>

      <div className="card-glass rounded-2xl p-4">
        <p className="font-semibold mb-2">{tr("admin.tasks_count", { count: tasks?.length ?? 0 })}</p>
        <div className="space-y-2">
          {tasks?.map((t: any) => (
            <div key={t.id} className="rounded-xl bg-background/40 p-3 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm truncate">{t.title}</p>
                  {!t.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tr("common.off")}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t.kind} · +{formatGram(t.reward)} GRAM
                  {t.target_chat ? ` · ${t.target_chat}` : ""}
                </p>
              </div>
              <button className="p-2 rounded-lg card-glass" onClick={() => setForm({
                id: t.id, code: t.code, title: t.title, description: t.description ?? "",
                reward: Number(t.reward), kind: t.kind, min_deposit: Number(t.min_deposit ?? 0),
                link: t.link ?? "", target_chat: t.target_chat ?? "", is_active: !!t.is_active,
              })}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button className="p-2 rounded-lg card-glass text-destructive"
                onClick={() => { if (confirm(tr("admin.delete_confirm"))) remove.mutate(t.id); }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {!tasks?.length && <p className="text-xs text-muted-foreground">{tr("admin.no_tasks")}</p>}
        </div>
      </div>
    </div>
  );
}
