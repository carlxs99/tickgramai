import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { Pickaxe, ListChecks, Users, ArrowDownToLine, ArrowUpFromLine, Sparkles, Copy, CheckCircle2, Coins, Trophy, Loader2, Wallet, Shield, Plus, Trash2, Pencil, ExternalLink, X, HelpCircle, Megaphone, ArrowLeft, Search, UserCircle2, Gift, Lock, Send, Activity, LayoutDashboard, ChevronRight, TrendingUp, Circle, ShieldAlert, Ban, Fingerprint, AlertTriangle } from "lucide-react";
import { toast, Toaster } from "sonner";
import { TonConnectUIProvider, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";

import { authWithTelegram } from "@/lib/telegram-auth.functions";
import { getMe, collectIncome, listTasks, completeTask, listDeposits, submitWithdrawal, listWithdrawals, getTopMiners, getMyRank, getFriends, getReferralStats, listReferralMilestones, claimReferralMilestone, saveWallet, reinvestBalance, listPartnerTasks, listMyPartnerTasks, createPartnerTask, completePartnerTask, cancelPartnerTask } from "@/lib/miner.functions";
import { listGiftBoxes, openGiftBox, claimDailyGiftBox } from "@/lib/gift-boxes.functions";
import { adminStats, adminListTasks, adminSaveTask, adminDeleteTask, adminListUsers, adminUserDetails, adminSuspiciousAccounts, adminListBanned, adminSetBan } from "@/lib/admin.functions";
import { getTonPrice } from "@/lib/prices.functions";
import { getTelegram, restoreSession } from "@/lib/telegram";
import { formatGram, formatReward, avatarSrc } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { LanguageProvider, LanguageSwitcher, useT } from "@/i18n";
import { markAppReady } from "@/lib/app-ready";
import { OnboardingTutorial, openTutorial } from "@/components/OnboardingTutorial";
import treasureChestImg from "@/assets/treasure-chest.png";
import coins3dImg from "@/assets/gram-coins-3d.png.asset.json";
import gramLogoImg from "@/assets/gram-logo.png.asset.json";
import tickgramLogoImg from "@/assets/tickgram-logo.png.asset.json";



const RECEIVING_WALLET = "UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn";

export const Route = createFileRoute("/")({
  ssr: false,
  component: MinerApp,
});

type Tab = "mine" | "tasks" | "top" | "friends" | "deposit" | "withdraw" | "stats" | "admin";

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
  const meFn = useServerFn(getMe);
  const tasksFn = useServerFn(listTasks);
  const partnersFn = useServerFn(listPartnerTasks);
  const giftFn = useServerFn(listGiftBoxes);
  const priceFn = useServerFn(getTonPrice);
  const qc = useQueryClient();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // Start the stats stream on app boot so it's already populated
    // whenever the user opens the Stats tab — no loading spinner.
    statsStore.start();


    // Preload all the data the app needs so that when the splash screen
    // disappears the user sees a fully rendered app (no extra loading).
    const finishBoot = async () => {
      await Promise.allSettled([
        qc.prefetchQuery({ queryKey: ["me"], queryFn: () => meFn() }),
        qc.prefetchQuery({ queryKey: ["me-header"], queryFn: () => meFn() }),
        qc.prefetchQuery({ queryKey: ["tasks"], queryFn: () => tasksFn() }),
        qc.prefetchQuery({ queryKey: ["partner-tasks"], queryFn: () => partnersFn() }),
        qc.prefetchQuery({ queryKey: ["gift-boxes"], queryFn: () => giftFn() }),
        qc.prefetchQuery({ queryKey: ["ton-price"], queryFn: () => priceFn() }),
      ]);
      setReady(true);
      markAppReady();
    };

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
          await finishBoot();
          return;
        }

        // No real initData. Reuse existing session if present.
        if (existing.session) { await finishBoot(); return; }

        // Outside Telegram (dev/browser) → demo. Inside Telegram without
        // initData → the Mini App was opened without a WebApp button.
        if (insideTelegram) {
          setError(t("auth.telegram_no_identity"));
          markAppReady();
          return;
        }

        const demoId = Math.floor(1_000_000 + Math.random() * 9_000_000);
        const tokens = await authFn({ data: { demoId } });
        await restoreSession(tokens);
        await finishBoot();
      } catch (e: any) {
        setError(e?.message ?? t("auth.failed"));
        markAppReady();
      }
    })();
  }, [authFn, t, qc, meFn, tasksFn, partnersFn, giftFn, priceFn]);

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
  if (!ready) return <div className="fixed inset-0 bg-background" aria-hidden />;

  // Banned accounts get a full-screen block — no app access at all.
  const meCached: any = qc.getQueryData(["me"]);
  if (meCached?.profile?.banned) {
    return <BannedScreen profile={meCached.profile} />;
  }



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
        <OnboardingTutorial />
        {tab === "mine" && <Header onAdminClick={() => setTab("admin")} setTab={setTab} />}



        <AnimatePresence mode="wait">
          <motion.main
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            onAnimationStart={() => { try { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); } catch { window.scrollTo(0, 0); } }}
            className="px-4 pt-4"
          >
            <Suspense fallback={<div className="min-h-[50vh]" aria-hidden />}>
              {tab === "mine" && <MineTab />}
              {tab === "tasks" && <TasksTab />}
              {tab === "top" && <LeaderboardTab />}
              {tab === "friends" && <FriendsTab />}
              {tab === "deposit" && <DepositTab />}
              {tab === "withdraw" && <WithdrawTab />}
              {tab === "stats" && <StatsTab />}
              {tab === "admin" && <AdminTab />}
            </Suspense>
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

// TON price hook — real-time via Binance WebSocket stream, with server polling fallback
function useTonPrice() {
  const fn = useServerFn(getTonPrice);
  const q = useQuery({
    queryKey: ["ton-price"],
    queryFn: () => fn(),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    staleTime: 5_000,
    gcTime: 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  const [livePrice, setLivePrice] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByUs = false;
    let attempts = 0;

    const connect = () => {
      try {
        ws = new WebSocket("wss://stream.binance.com:9443/ws/tonusdt@trade");
        ws.onopen = () => { attempts = 0; };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            const p = parseFloat(msg?.p);
            if (isFinite(p) && p > 0) setLivePrice(p);
          } catch {}
        };
        ws.onclose = () => {
          if (closedByUs) return;
          attempts += 1;
          const delay = Math.min(1000 * 2 ** attempts, 15_000);
          reconnectTimer = setTimeout(connect, delay);
        };
        ws.onerror = () => { try { ws?.close(); } catch {} };
      } catch {
        attempts += 1;
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15_000));
      }
    };
    connect();

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
    };
  }, []);

  return livePrice ?? q.data?.price ?? 5.5;
}

function usdt(gram: number, price: number) {
  const v = gram * price;
  if (!isFinite(v)) return "0.00";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function Header({ onAdminClick, setTab }: { onAdminClick: () => void; setTab: (t: Tab) => void }) {
  const { t } = useT();
  const meFn = useServerFn(getMe);
  const { data } = useQuery({ queryKey: ["me-header"], queryFn: () => meFn(), refetchInterval: 15000 });
  const price = useTonPrice();
  const name = data?.profile.first_name ?? data?.profile.username ?? "Miner";
  const initial = name.slice(0, 1).toUpperCase();
  const bal = Number(data?.profile.balance ?? 0);
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-white/5">
      {/* Row 1 — welcome + name + right-side actions */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 pt-3">
        <div className="w-11 h-11 shrink-0 rounded-full bg-white flex items-center justify-center ring-2 ring-white/20 overflow-hidden">
          <img src={tickgramLogoImg.url} alt="TickGram" className="w-full h-full object-contain" />
        </div>
        <div className="min-w-0 overflow-hidden">
          <p className="eyebrow text-white/85 leading-snug !text-[9px]">{t("header.ai_analyzing")}</p>
          <p className="font-display font-bold text-lg sm:text-xl truncate leading-tight text-gradient-light text-glow-white">{name}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <LanguageSwitcher />
          <button
            onClick={() => openTutorial()}
            className="h-8 w-8 rounded-lg card-glass text-primary flex items-center justify-center"
            aria-label={t("tutorial.help")}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          {data?.isAdmin && (
            <button
              onClick={onAdminClick}
              className="h-8 w-8 rounded-lg card-glass text-primary flex items-center justify-center"
              aria-label={t("header.admin_panel")}
            >
              <Shield className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Row 2 — Deposit | Balance chip | Withdraw */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-3">
        <button
          onClick={() => { setTab("deposit"); getTelegram()?.HapticFeedback?.impactOccurred("light"); }}
          className="h-10 pl-1.5 pr-3.5 rounded-full bg-white text-[#1a1240] font-semibold text-[13px] flex items-center gap-1.5 shadow-md shadow-black/10 active:scale-95 transition"
        >
          <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
            <Plus className="w-4 h-4" strokeWidth={3} />
          </span>
          {t("nav.deposit")}
        </button>

        <div className="h-12 rounded-full card-glass bg-white/10 flex items-center gap-2 px-3 min-w-0">
          <img src={gramLogoImg.url} alt="GRAM" className="w-8 h-8 rounded-full object-cover shrink-0" />
          <div className="flex flex-col min-w-0 leading-tight">
            <span className="font-bold text-sm tabular-nums truncate">{formatGram(bal, 4)} GRAM</span>
            <span className="text-[11px] tabular-nums text-[color:var(--gold)] truncate">${usdt(bal, price)}</span>
          </div>
        </div>

        <button
          onClick={() => { setTab("withdraw"); getTelegram()?.HapticFeedback?.impactOccurred("light"); }}
          className="h-10 pl-1.5 pr-3.5 rounded-full bg-white text-[#1a1240] font-semibold text-[13px] flex items-center gap-1.5 shadow-md shadow-black/10 active:scale-95 transition"
        >
          <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
            <ArrowUpFromLine className="w-3.5 h-3.5" strokeWidth={3} />
          </span>
          {t("nav.cash")}
        </button>
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

  const price = useTonPrice();
  const rateUsd = Number((data.profile as any).mining_rate_usd ?? 0);
  const rate = price > 0 ? rateUsd / price : 0; // GRAM/day at current TON price

  const live = useMemo(() => {
    const now = Date.now();
    const last = new Date(data.profile.last_collect_at).getTime();
    const secs = Math.max(0, (now - last) / 1000);
    return (rate / 86400) * secs;
  }, [data, tick, rate]);

  const collect = useMutation({
    mutationFn: () => collectFn(),
    onSuccess: (r) => {
      getTelegram()?.HapticFeedback?.impactOccurred("medium");
      toast.success(`+${formatGram(r.gained, 4)} GRAM ${t("mine.collected_toast")}`);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? t("common.failed")),
  });

  return (
    <div className="space-y-4">
      <motion.div
        className="relative rounded-3xl p-5 overflow-hidden shadow-xl"
        initial={{ scale: 0.96 }} animate={{ scale: 1 }}
        style={{
          background:
            "linear-gradient(135deg, oklch(0.22 0.06 255) 0%, oklch(0.32 0.09 245) 50%, oklch(0.46 0.13 225) 100%)",
        }}
      >
        {/* Ambient glow blobs */}
        <div className="absolute -top-16 -left-10 w-56 h-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-10 w-64 h-64 rounded-full bg-cyan-400/20 blur-3xl pointer-events-none" />

        {/* 3D coins cluster */}
        <img
          src={coins3dImg.url}
          alt=""
          aria-hidden="true"
          loading="lazy"
          width={1024}
          height={1024}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-[62%] max-w-[260px] pointer-events-none select-none"
          style={{
            filter: "drop-shadow(0 12px 24px oklch(0.30 0.14 300 / 0.45))",
          }}
        />



        <div className="relative z-10">
          <div className="flex items-center gap-2 text-white/90 eyebrow">
            <Sparkles className="w-3.5 h-3.5" /> {t("mine.uncollected")}
          </div>
          <div className="mt-1 font-display text-4xl sm:text-5xl font-bold tabular-nums text-white leading-none text-glow-white">
            {formatGram(live, 6)}
          </div>
          <div className="mt-1 text-[11px] text-emerald-200 tabular-nums font-semibold">
            ≈ ${usdt(live, price)} USDT
          </div>

          <div className="mt-4 flex items-center gap-2 max-w-[70%]">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                try {
                  const key = "collect_ad_counter";
                  const n = (parseInt(localStorage.getItem(key) || "0", 10) || 0) + 1;
                  localStorage.setItem(key, String(n));
                  if (n % 2 === 0 && typeof (window as any).show_11237001 === "function") {
                    (window as any).show_11237001().then(() => {
                      collect.mutate();
                    }).catch(() => {
                      collect.mutate();
                    });
                    return;
                  }
                } catch {}
                collect.mutate();
              }}
              disabled={collect.isPending}
              className="flex items-center gap-1.5 pl-3 pr-4 py-2.5 rounded-full bg-white text-purple-900 font-bold text-[13px] shadow-lg disabled:opacity-60 whitespace-nowrap"
            >
              <span className="w-5 h-5 rounded-full bg-purple-600 text-white grid place-items-center shrink-0">
                <Plus className="w-3.5 h-3.5" strokeWidth={3} />
              </span>
              {collect.isPending ? t("mine.collecting") : t("mine.collect")}
            </motion.button>

            {rate > 0 && (
              <div className="flex items-center gap-1 px-2.5 py-2 rounded-full bg-white/15 backdrop-blur-sm text-white text-[11px] font-semibold tabular-nums whitespace-nowrap">
                <Coins className="w-3.5 h-3.5 text-amber-200" />
                +{formatGram(rate / 24, 6)} GRAM/h
              </div>
            )}
          </div>

          <div className="mt-3 text-[11px] text-white/70 max-w-[65%]">
            {rateUsd > 0
              ? <>{formatGram(rate, 6)} GRAM/day · ${rateUsd.toFixed(5)}/day</>
              : t("mine.deposit_to_start")}
          </div>
        </div>
      </motion.div>


      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t("mine.balance")} value={formatGram(data.profile.balance, 6)} sub={`≈ $${usdt(Number(data.profile.balance), price)}`} icon={<Coins className="w-4 h-4 text-[color:var(--gold)]" />} valueClassName="text-black" />
        <StatCard label={t("mine.deposits")} value={formatReward(data.profile.deposit_total) + " GRAM"} sub={t("mine.gram_price", { price: price.toFixed(2) })} icon={<ArrowDownToLine className="w-4 h-4 text-[color:var(--info)]" />} valueClassName="text-black" />
      </div>

      <GiftBoxesCard />
    </div>
  );
}

function GiftBoxVisual({ unopened, size = 88 }: { unopened: number; size?: number }) {
  const hasBoxes = unopened > 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* Animated ambient golden glow */}
      <motion.div
        className="absolute inset-0 rounded-full blur-2xl"
        animate={hasBoxes
          ? { opacity: [0.5, 0.85, 0.5], scale: [0.9, 1.12, 0.9] }
          : { opacity: 0.4, scale: 1 }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background: "radial-gradient(circle, oklch(0.88 0.2 85 / 0.9) 0%, oklch(0.72 0.17 75 / 0.4) 45%, transparent 72%)",
        }}
      />

      {/* Light rays behind chest */}
      {hasBoxes && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, oklch(0.95 0.18 85 / 0.35) 10deg, transparent 20deg, transparent 60deg, oklch(0.95 0.18 85 / 0.3) 70deg, transparent 80deg, transparent 140deg, oklch(0.95 0.18 85 / 0.35) 150deg, transparent 160deg, transparent 220deg, oklch(0.95 0.18 85 / 0.3) 230deg, transparent 240deg, transparent 300deg, oklch(0.95 0.18 85 / 0.35) 310deg, transparent 320deg)",
            maskImage: "radial-gradient(circle, black 30%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(circle, black 30%, transparent 70%)",
          }}
        />
      )}

      {/* Floating chest */}
      <motion.div
        className="relative flex items-center justify-center"
        animate={hasBoxes ? { y: [0, -4, 0] } : {}}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        style={{ width: size, height: size }}
      >
        <motion.img
          src={treasureChestImg}
          alt="Treasure chest"
          width={size}
          height={size}
          loading="lazy"
          className="relative select-none pointer-events-none"
          style={{
            width: size,
            height: size,
            objectFit: "contain",
            filter: "drop-shadow(0 10px 18px oklch(0.35 0.12 75 / 0.55))",
          }}
          animate={hasBoxes ? { scale: [1, 1.04, 1] } : {}}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Sparkle overlays */}
        {hasBoxes && (
          <>
            {[
              { top: "10%", left: "18%", d: 0 },
              { top: "22%", left: "82%", d: 0.6 },
              { top: "58%", left: "6%", d: 1.1 },
              { top: "70%", left: "88%", d: 0.3 },
              { top: "8%", left: "58%", d: 0.9 },
            ].map((s, i) => (
              <motion.span
                key={i}
                className="absolute rounded-full"
                style={{
                  top: s.top,
                  left: s.left,
                  width: 6,
                  height: 6,
                  background:
                    "radial-gradient(circle, white 0%, oklch(0.95 0.18 85) 40%, transparent 70%)",
                }}
                animate={{ opacity: [0, 1, 0], scale: [0.3, 1.4, 0.3] }}
                transition={{ duration: 1.8, repeat: Infinity, delay: s.d, ease: "easeInOut" }}
              />
            ))}
          </>
        )}

        {/* Count badge */}
        {hasBoxes && (
          <div className="absolute -top-1 -right-1 z-10">
            <div className="relative w-7 h-7 flex items-center justify-center">
              <svg viewBox="0 0 28 28" className="absolute inset-0 w-full h-full drop-shadow-md">
                <defs>
                  <linearGradient id="sealGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="oklch(0.92 0.12 85)" />
                    <stop offset="50%" stopColor="oklch(0.82 0.16 80)" />
                    <stop offset="100%" stopColor="oklch(0.65 0.14 75)" />
                  </linearGradient>
                </defs>
                <circle cx="14" cy="14" r="12" fill="url(#sealGrad)" stroke="white" strokeWidth="1.5" />
              </svg>
              <span className="relative z-10 text-[11px] font-black text-purple-900 leading-none">
                {unopened}
              </span>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}


function GiftBoxesCard() {
  const { t } = useT();
  const listFn = useServerFn(listGiftBoxes);
  const openFn = useServerFn(openGiftBox);
  const claimDailyFn = useServerFn(claimDailyGiftBox);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["gift-boxes"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
  });
  const unopened = data?.unopenedCount ?? 0;
  const activeBonus = data?.activeBonus as { percent: number; expires_at: string } | null | undefined;
  const canClaimDaily = data?.canClaimDaily ?? false;
  const nextDailyAt = data?.nextDailyAt ?? null;
  const [prize, setPrize] = useState<{ prizeType: string; prizeAmount: number } | null>(null);

  const firstUnopened = (data?.boxes ?? []).find((b: any) => b.status === "unopened");
  const openMut = useMutation({
    mutationFn: () => openFn({ data: { boxId: firstUnopened!.id } }),
    onSuccess: (r) => {
      getTelegram()?.HapticFeedback?.impactOccurred?.("heavy");
      setPrize({ prizeType: r.prizeType, prizeAmount: r.prizeAmount });
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const claimMut = useMutation({
    mutationFn: () => claimDailyFn(),
    onSuccess: () => {
      getTelegram()?.HapticFeedback?.impactOccurred?.("medium");
      toast.success(t("gift.daily_claimed"));
      qc.invalidateQueries({ queryKey: ["gift-boxes"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const canOpen = unopened > 0 && !openMut.isPending && !prize;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-3xl p-5 overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.22 0.06 255) 0%, oklch(0.30 0.09 245) 60%, oklch(0.44 0.13 225) 100%)",
        }}
      >
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <GiftBoxVisual unopened={unopened} size={84} />
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-1 text-[10px] font-bold tracking-widest text-amber-200 uppercase">
              <Sparkles className="w-3 h-3" /> {t("gift.title")}
            </div>
            <div className="text-lg font-extrabold text-white leading-tight mt-0.5">
              {unopened > 0
                ? t(unopened === 1 ? "gift.have_boxes" : "gift.have_boxes_plural", { count: String(unopened) })
                : t("gift.invite_cta")}
            </div>
            <div className="text-[11px] text-white/70 mt-0.5">
              {t("gift.rule")}
            </div>
            <div className="text-[11px] font-bold text-amber-200 mt-0.5">
              {t("gift.rewards_hint")}
            </div>
          </div>
        </div>

        {/* Daily free gift box */}
        <div className="relative mt-3 rounded-xl bg-black/25 px-3 py-2 flex items-center gap-2">
          <Gift className="w-4 h-4 text-emerald-300 shrink-0" />
          <div className="flex-1 text-[11px] text-white leading-tight">
            <div className="font-bold text-emerald-200">{t("gift.daily_title")}</div>
            <div className="text-white/70">
              {canClaimDaily
                ? t("gift.daily_available")
                : t("gift.daily_next_in")}
            </div>
          </div>
          {canClaimDaily ? (
            <button
              onClick={() => !claimMut.isPending && claimMut.mutate()}
              disabled={claimMut.isPending}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-emerald-400 text-emerald-950 disabled:opacity-60"
            >
              {claimMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t("gift.daily_claim")}
            </button>
          ) : nextDailyAt ? (
            <BonusCountdown expiresAt={nextDailyAt} />
          ) : null}
        </div>

        {activeBonus && (
          <div className="relative mt-3 rounded-xl bg-black/25 px-3 py-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
            <div className="flex-1 text-[11px] text-white">
              {t("gift.active_bonus")} <span className="font-bold text-amber-200">+{Number(activeBonus.percent).toFixed(1)}%</span> {t("gift.active_bonus_suffix")}
            </div>
            <BonusCountdown expiresAt={activeBonus.expires_at} />
          </div>
        )}

        <button
          onClick={() => canOpen && openMut.mutate()}
          disabled={!canOpen}
          className="relative mt-4 w-full py-3 rounded-2xl font-bold text-sm bg-white text-purple-900 disabled:opacity-70 disabled:cursor-not-allowed shadow-lg flex items-center justify-center gap-2"
        >
          {openMut.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> {t("gift.opening")}</>
          ) : unopened > 0 ? (
            <><Gift className="w-4 h-4" /> {t("gift.open")}</>
          ) : (
            <>{t("gift.no_boxes_yet")}</>
          )}
        </button>

      </motion.div>

      <AnimatePresence>
        {prize && <PrizeModal prize={prize} onClose={() => setPrize(null)} />}
      </AnimatePresence>
    </>
  );
}

function BonusCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const ms = Math.max(0, new Date(expiresAt).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return (
    <div className="text-[10px] tabular-nums text-white/70 font-semibold">
      {h}h {m}m {s}s
    </div>
  );
}

function ActiveBonusBanner() {
  const { t } = useT();
  const listFn = useServerFn(listGiftBoxes);
  const { data } = useQuery({
    queryKey: ["gift-boxes"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
  });
  const bonus = data?.activeBonus as { percent: number; expires_at: string } | null | undefined;
  if (!bonus) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative rounded-2xl p-3 overflow-hidden flex items-center gap-3"
      style={{
        background:
          "linear-gradient(135deg, oklch(0.22 0.06 255) 0%, oklch(0.30 0.09 245) 60%, oklch(0.44 0.13 225) 100%)",
      }}
    >
      <div className="w-9 h-9 rounded-xl bg-amber-400/90 flex items-center justify-center shrink-0">
        <Sparkles className="w-5 h-5 text-black" strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold tracking-widest text-amber-200 uppercase">
          {t("gift.title")}
        </div>
        <div className="text-sm font-extrabold text-white leading-tight">
          {t("gift.active_bonus")}{" "}
          <span className="text-amber-200">+{Number(bonus.percent).toFixed(1)}%</span>{" "}
          {t("gift.active_bonus_suffix")}
        </div>
      </div>
      <BonusCountdown expiresAt={bonus.expires_at} />
    </motion.div>
  );
}


function PrizeModal({ prize, onClose }: { prize: { prizeType: string; prizeAmount: number }; onClose: () => void }) {
  const { t } = useT();
  const isGram = prize.prizeType === "gram_mining";
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.7, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        transition={{ type: "spring", damping: 18 }}
        className="relative w-full max-w-sm rounded-3xl p-6 text-center overflow-hidden"
        style={{ background: "linear-gradient(160deg, oklch(0.22 0.06 255), oklch(0.44 0.13 225))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-3 right-3 text-white/60 hover:text-white">
          <X className="w-5 h-5" />
        </button>
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", damping: 12, delay: 0.1 }}
          className="mx-auto w-24 h-24 rounded-3xl bg-gradient-to-br from-amber-300 to-amber-600 flex items-center justify-center shadow-2xl"
        >
          <Gift className="w-12 h-12 text-white" strokeWidth={2.5} />
        </motion.div>
        <div className="mt-4 text-xs font-bold tracking-widest text-amber-200 uppercase">{t("gift.prize_title")}</div>
        <div className="mt-1 text-3xl font-extrabold text-white tabular-nums">
          {isGram
            ? `+${(prize.prizeAmount * 0.033).toFixed(10).replace(/0+$/, "").replace(/\.$/, "")} GRAM${t("gift.per_day")}`
            : `+${prize.prizeAmount.toFixed(2)}%`}
        </div>
        <div className="text-xs text-white/70 mt-1">
          {isGram ? t("gift.prize_gram_sub") : t("gift.prize_bonus_sub")}
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full py-3 rounded-2xl bg-white text-purple-900 font-bold"
        >
          {t("gift.cool")}
        </button>
      </motion.div>
    </motion.div>

  );
}


function StatCard({ label, value, sub, icon, valueClassName }: { label: string; value: string; sub?: string; icon: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="card-glass rounded-2xl p-4">
      <div className="flex items-center gap-1.5 eyebrow text-muted-foreground !text-[10px]">{icon}{label}</div>
      <div className={`mt-1 font-display text-xl font-bold tabular-nums ${valueClassName ?? "text-gradient"}`}>{value}</div>
      {sub && <div className="text-[10px] text-[color:var(--success)] tabular-nums font-semibold">{sub}</div>}
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
  const price = useTonPrice();
  const name = miner ? (miner.first_name || miner.username || t("leaderboard.anon")) : "—";
  const rateUsd = miner ? Number(miner.mining_rate_usd ?? 0) : 0;
  const rateGram = price > 0 ? rateUsd / price : 0;
  const rateLabel = miner ? `$${rateUsd.toFixed(5)}` : "—";
  return (
    <div className={`flex-1 basis-0 min-w-0 flex flex-col items-center ${styles.order}`}>
      <div className="relative shrink-0">
        {styles.crown && (
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-2xl select-none">👑</div>
        )}
        <div className={`${styles.avatar} rounded-full bg-gradient-to-br from-primary/60 to-accent/60 ${styles.ring} flex items-center justify-center font-bold text-primary-foreground overflow-hidden`}>
          {miner?.avatar_url || miner?.telegram_id ? (
            <img src={avatarSrc(miner.avatar_url, miner.telegram_id)} alt={name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          ) : (
            <span>{podiumInitial(miner)}</span>
          )}
        </div>
        <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full ${styles.badge} text-xs font-bold flex items-center justify-center ring-2 ring-background`}>
          {rank}
        </div>
      </div>
      <p className="mt-2 text-xs font-semibold text-center truncate w-full px-1">{name}</p>
      <p className="text-[10px] text-muted-foreground truncate w-full text-center px-1">≈ {formatGram(rateGram, 5)} GRAM/d</p>
      <div className={`mt-2 w-full ${styles.height} ${styles.bar} rounded-t-2xl relative overflow-hidden`}>
        <div className="absolute inset-x-0 top-2 text-center">
          <div className="text-base font-extrabold text-black/90 drop-shadow">{rateLabel}</div>
          <div className="text-[9px] font-semibold text-black/70 tracking-wider">USDT/d</div>
        </div>
      </div>
    </div>
  );
}

function LeaderboardTab() {
  const { t } = useT();
  const fn = useServerFn(getTopMiners);
  const rankFn = useServerFn(getMyRank);
  const price = useTonPrice();
  const { data } = useQuery({ queryKey: ["top"], queryFn: () => fn(), refetchInterval: 30_000 });
  const { data: myRank, isLoading: isMyRankLoading, isError: isMyRankError } = useQuery({ queryKey: ["myRank"], queryFn: () => rankFn(), refetchInterval: 60_000 });
  const list = (data ?? []) as any[];
  const top3 = [list[0], list[1], list[2]];
  const rest = list.slice(3);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white text-glow-white">{t("leaderboard.title")}</h2>
        <p className="text-xs text-white/80">{t("leaderboard.subtitle")}</p>
      </div>

      <div className="card-glass rounded-2xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-[color:var(--gold)]" />
          <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Your rank</span>
        </div>
        <span className="text-lg font-bold tabular-nums">
          {isMyRankLoading ? "..." : isMyRankError ? "—" : `#${(myRank as any)?.rank ?? "—"}`}
        </span>
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
          <PaginatedList
            items={rest}
            pageSize={10}
            renderItem={(m: any, absIdx: number) => {
              const rank = absIdx + 4;
              const name = m.first_name || m.username || t("leaderboard.anon");
              return (
                <div key={rank} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-8 text-center text-xs font-bold text-muted-foreground">#{rank}</span>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 flex items-center justify-center text-sm font-bold overflow-hidden">
                    {m.avatar_url || m.telegram_id ? <img src={avatarSrc(m.avatar_url, m.telegram_id)} alt={name} referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : podiumInitial(m)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{name}</p>
                    <p className="text-[10px] text-muted-foreground">≈ {formatGram(price > 0 ? Number(m.mining_rate_usd ?? 0) / price : 0, 5)} GRAM/d</p>
                  </div>
                  <span className="text-sm tabular-nums text-[color:var(--success)] font-semibold">${Number(m.mining_rate_usd ?? 0).toFixed(5)}/d</span>
                </div>
              );
            }}
          />
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
    onSuccess: (r: any) => { toast.success(`+${formatReward(Number(r.rewardGram ?? r.reward ?? 0))} GRAM/día en minería`); getTelegram()?.HapticFeedback?.impactOccurred("light"); qc.invalidateQueries(); },
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
      <h2 className="text-2xl font-bold text-white text-glow-white">{tr("tasks.title")}</h2>
      <p className="text-sm text-white/80">{tr("tasks.subtitle")}</p>
      <div className="space-y-2 mt-3">
        {data.map((t: any) => {
          const share = isShareTask(t);
          const hasShared = shared[t.id];
          return (
          <div key={t.id} className="card-glass rounded-2xl p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{t.title}</p>
              {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
              <p className="text-xs mt-1 text-[color:var(--success)]">+{formatReward(Number(t.reward) * 0.033)} GRAM/día ⛏️</p>
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
      <PartnerTasksSection />
    </div>
  );
}


function PartnerTasksSection() {
  const { t: tr } = useT();
  const qc = useQueryClient();
  const listFn = useServerFn(listPartnerTasks);
  const myListFn = useServerFn(listMyPartnerTasks);
  const createFn = useServerFn(createPartnerTask);
  const completeFn = useServerFn(completePartnerTask);
  const cancelFn = useServerFn(cancelPartnerTask);
  const meFn = useServerFn(getMe);
  const { data: me } = useSuspenseQuery(meQO(() => meFn()));
  const isAdmin = !!(me as any)?.isAdmin;

  const { data: partners } = useQuery({ queryKey: ["partner-tasks"], queryFn: () => listFn(), refetchInterval: 30000 });
  const { data: mine } = useQuery({ queryKey: ["my-partner-tasks"], queryFn: () => myListFn(), refetchInterval: 20000 });

  const [showAdd, setShowAdd] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [visited, setVisited] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Object.keys(visited).length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [visited]);
  const CLAIM_DELAY_MS = 10_000;

  const complete = useMutation({
    mutationFn: (partnerTaskId: string) => completeFn({ data: { partnerTaskId } }),
    onSuccess: (r) => {
      toast.success(`+${formatReward(r.reward)} GRAM`);
      getTelegram()?.HapticFeedback?.impactOccurred("light");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? tr("common.failed")),
  });

  const openLink = (pt: any) => {
    const tg: any = getTelegram();
    if (tg?.openTelegramLink && /t\.me/.test(pt.link)) tg.openTelegramLink(pt.link);
    else if (tg?.openLink) tg.openLink(pt.link);
    else window.open(pt.link, "_blank");
    setVisited((v) => ({ ...v, [pt.id]: Date.now() }));
  };

  return (
    <div className="space-y-3 mt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-bold">{tr("partner.title")}</h3>
          <button onClick={() => setShowHelp(true)} className="text-muted-foreground">
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl card-glass text-sm font-semibold"
        >
          <Plus className="w-4 h-4 text-primary" /> {tr("partner.add")}
        </button>
      </div>

      {(!partners || partners.length === 0) ? (
        <div className="card-glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
          {tr("partner.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {partners.map((pt: any) => (
            <div key={pt.id} className="card-glass rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                <Megaphone className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{pt.title}</p>
                <p className="text-xs mt-0.5 text-[color:var(--success)]">+{formatReward(pt.reward_per_click)} GRAM</p>
              </div>
              {(() => {
                const visitedAt = visited[pt.id];
                if (!visitedAt) {
                  return (
                    <button
                      onClick={() => openLink(pt)}
                      className="px-3 py-2 rounded-xl card-glass text-sm font-semibold flex items-center gap-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> {tr("partner.open")}
                    </button>
                  );
                }
                const remainingMs = CLAIM_DELAY_MS - (now - visitedAt);
                if (remainingMs > 0) {
                  return (
                    <button
                      disabled
                      className="px-4 py-2 rounded-xl card-glass text-sm font-semibold tabular-nums opacity-60"
                    >
                      {Math.ceil(remainingMs / 1000)}s
                    </button>
                  );
                }
                return (
                  <button
                    onClick={() => complete.mutate(pt.id)}
                    disabled={complete.isPending}
                    className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
                  >
                    {tr("tasks.claim")}
                  </button>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {mine && mine.length > 0 && (
        <div className="card-glass rounded-2xl p-4 mt-3">
          <p className="font-semibold text-sm mb-2">{tr("partner.my_tasks")}</p>
          <div className="space-y-2">
            {mine.map((pt: any) => (
              <div key={pt.id} className="flex justify-between items-center text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{pt.title}</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">{pt.status}</p>
                  <p className="text-[10px] text-[color:var(--success)] tabular-nums">
                    {pt.current_clicks ?? 0} / {pt.target_clicks} {tr("partner.clicks")}
                  </p>
                </div>
                {pt.status === "pending_payment" && (
                  <button
                    onClick={() => {
                      cancelFn({ data: { partnerTaskId: pt.id } }).then(() => qc.invalidateQueries());
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] text-[color:var(--danger)]"
                  >
                    {tr("common.cancel")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && <AddPartnerTaskModal onClose={() => setShowAdd(false)} createFn={createFn} qc={qc} isAdmin={isAdmin} />}
      {showHelp && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setShowHelp(false)}>
          <div className="card-glass rounded-2xl p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold">{tr("partner.help_title")}</h4>
              <button onClick={() => setShowHelp(false)}><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-line">{tr("partner.help_body")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function AddPartnerTaskModal({ onClose, createFn, qc, isAdmin }: any) {
  const { t: tr } = useT();
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [kind, setKind] = useState<"link" | "channel" | "group" | "bot">("channel");
  const [clicks, setClicks] = useState(500);
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();

  const clicksNum = Math.max(0, Math.floor(Number(clicks) || 0));
  const costTon = isAdmin ? 0 : clicksNum * 0.001;
  const canSubmit =
    title.trim().length >= 2 &&
    /^https?:\/\//i.test(link.trim()) &&
    clicksNum >= 250 &&
    (isAdmin || !!wallet);

  const submit = useMutation({
    mutationFn: async () => {
      if (!isAdmin && !wallet) throw new Error(tr("deposit.err_connect"));
      // 1) Create partner task. For admins it is created directly as active (free).
      const created: any = await createFn({
        data: { title: title.trim(), link: link.trim(), kind, targetClicks: clicksNum },
      });
      // 2) Non-admin: send TON payment with the memo to activate the task.
      if (!created?.is_admin_free) {
        const payload = buildCommentPayload(created.memo_tag);
        const nano = Math.floor(Number(created.cost_ton) * 1e9).toString();
        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 300,
          messages: [{ address: RECEIVING_WALLET, amount: nano, payload }],
        });
      }
      return created;
    },
    onSuccess: () => {
      toast.success(tr("partner.created"));
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? tr("common.failed")),
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card-glass rounded-2xl p-5 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            <h4 className="font-bold text-lg">{tr("partner.modal_title")}</h4>
          </div>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>

        <Field label={tr("partner.form_title")}>
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={tr("partner.form_title_ph")} className="input" />
        </Field>

        <Field label={tr("partner.form_link")}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://t.me/..." className="input" />
        </Field>

        <Field label={tr("partner.form_kind")}>
          <div className="grid grid-cols-4 gap-2">
            {(["channel", "group", "bot", "link"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-2 py-2 rounded-xl text-xs font-semibold ${kind === k ? "bg-primary text-primary-foreground" : "card-glass"}`}
              >
                {tr(`partner.kind_${k}`)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={tr("partner.form_clicks")}>
          <input
            type="number"
            min={250}
            step={50}
            value={clicks}
            onChange={(e) => setClicks(Number(e.target.value))}
            className="input"
          />
          <p className="text-[10px] text-muted-foreground mt-1">{tr("partner.form_clicks_help")}</p>
        </Field>

        <div className="rounded-xl bg-primary/10 px-4 py-3 text-center">
          <p className="text-sm">
            {isAdmin ? (
              <span className="font-bold text-primary">Admin · Free publish</span>
            ) : (
              <>
                {tr("partner.cost_label")} <span className="font-bold tabular-nums">{costTon.toFixed(4)} GRAM</span>
              </>
            )}
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl card-glass font-semibold">
            {tr("common.cancel")}
          </button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={!canSubmit || submit.isPending}
            onClick={() => submit.mutate()}
            className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-primary via-accent to-primary font-bold text-primary-foreground disabled:opacity-50"
          >
            {submit.isPending
              ? tr("deposit.waiting")
              : isAdmin
                ? tr("partner.add")
                : wallet
                  ? tr("partner.pay_and_create")
                  : tr("deposit.connect_wallet")}
          </motion.button>
        </div>
      </div>
    </div>
  );
}



function FriendsTab() {
  const { t } = useT();
  const meFn = useServerFn(getMe);
  const frFn = useServerFn(getFriends);
  const statsFn = useServerFn(getReferralStats);
  const milestonesFn = useServerFn(listReferralMilestones);
  const claimMilestoneFn = useServerFn(claimReferralMilestone);
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQO(() => meFn()));
  const { data: friends } = useQuery({ queryKey: ["friends"], queryFn: () => frFn() });
  const { data: stats } = useQuery({ queryKey: ["referral-stats"], queryFn: () => statsFn() });
  const { data: milestones } = useQuery({ queryKey: ["referral-milestones"], queryFn: () => milestonesFn() });
  const claimMilestone = useMutation({
    mutationFn: (tier: number) => claimMilestoneFn({ data: { tier } }),
    onSuccess: (r) => {
      toast.success(t("friends.milestone_reward_toast", { amount: formatGram(r.reward, 8) }));
      qc.invalidateQueries({ queryKey: ["referral-milestones"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Error"),
  });
  const code = me.profile.referral_code as string;
  const inviteUrl = `https://t.me/Tickgramaibot/app?startapp=${code}`;
  const shareText = t("tasks.share_default");
  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(shareText)}`;
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const list = friends ?? [];
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const s = (stats ?? {}) as {
    inviter?: { user_id: string; username: string | null; first_name: string | null; last_name: string | null; avatar_url: string | null; telegram_id?: number | null } | null;
    level1?: number;
    level2?: number;
    level3?: number;
    total_referrals?: number;
    total_earned?: number;
  };


  const inviter = s.inviter;
  const inviterName = inviter ? [inviter.first_name, inviter.last_name].filter(Boolean).join(" ") || inviter.username || t("leaderboard.anon") : null;

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteUrl);
    toast.success(t("common.copied"));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white text-glow-white">{t("friends.title")}</h2>
      <p className="text-sm text-white/80">{t("friends.subtitle")}</p>

      {/* Invited by */}
      {inviterName && (
        <div className="flex items-center gap-3 rounded-2xl card-glass p-4">
          {inviter?.avatar_url || inviter?.telegram_id ? (
            <img src={avatarSrc(inviter.avatar_url, inviter.telegram_id)} alt={inviterName} referrerPolicy="no-referrer" className="w-10 h-10 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center font-semibold shrink-0">
              {inviterName.slice(0, 1).toUpperCase()}
            </div>
          )}

          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t("friends.invited_by")}</p>
            <p className="text-sm font-semibold truncate">{inviterName}</p>
          </div>
        </div>
      )}


      {/* Main stats card — 3-level referral tree */}
      <div className="rounded-3xl p-5 text-white relative overflow-hidden bg-gradient-to-br from-primary to-accent">
        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-white/5 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-white/90">{t("friends.total_referrals")}</span>
            <span className="text-3xl font-extrabold tabular-nums">{s.total_referrals ?? 0}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t("friends.level1"), value: s.level1 ?? 0, pct: "10%", opacity: "bg-white/20" },
              { label: t("friends.level2"), value: s.level2 ?? 0, pct: "5%",  opacity: "bg-white/15" },
              { label: t("friends.level3"), value: s.level3 ?? 0, pct: "3%",  opacity: "bg-white/10" },
            ].map((lvl) => (
              <div key={lvl.label} className={`rounded-2xl ${lvl.opacity} backdrop-blur-sm p-3 text-center`}>
                <p className="text-[11px] text-white/80 font-medium">{lvl.label}</p>
                <p className="text-xl font-extrabold tabular-nums mt-0.5">{lvl.value}</p>
                <p className="text-[10px] text-white/70 mt-0.5">{lvl.pct}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-white/20 flex items-center justify-between">
            <span className="text-sm text-white/90">{t("friends.total_earned")}</span>
            <span className="text-lg font-semibold tabular-nums">{formatGram(s.total_earned ?? 0, 8)}</span>
          </div>
        </div>
      </div>

      {/* Referral milestones — show only the next unclaimed one */}
      {(() => {
        const next = (milestones ?? []).find((m) => !m.claimed);
        if (!next) return null;
        const active = Number(next.active_count ?? 0);
        const required = Number(next.required);
        const pct = Math.min(100, Math.round((active / required) * 100));
        const canClaim = active >= required;
        return (
          <div className="relative overflow-hidden rounded-2xl border border-[color:var(--gold)]/30 bg-white/95 backdrop-blur-md p-4 space-y-3 shadow-[0_14px_36px_-20px_oklch(0.2_0.08_245_/_0.28)]">
            {/* Soft gold shimmer */}
            <div className="pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full bg-[color:var(--gold)]/10 blur-3xl" />

            <div className="relative flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[color:var(--gold)]/15 border border-[color:var(--gold)]/25">
                  <Trophy className="w-4 h-4 text-[color:var(--gold)]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{t("friends.milestones_title")}</p>
                  <p className="text-[10px] text-slate-500">{t("friends.milestones_subtitle")}</p>
                </div>
              </div>
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-[color:var(--gold)]/15 border border-[color:var(--gold)]/25 text-[10px] font-bold text-amber-700 tabular-nums">
                +{formatGram(next.reward, 8)} GRAM
              </span>
            </div>

            <div className="relative rounded-xl border border-slate-200/80 bg-slate-50/80 backdrop-blur-sm p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-lg">👥</span>
                  <span className="text-sm font-bold tabular-nums text-slate-800">{active}<span className="text-slate-400"> / {required}</span></span>
                </div>
                <span className="text-[10px] font-semibold text-slate-500 tabular-nums">{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200/70 overflow-hidden border border-slate-200/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[color:var(--gold)] via-amber-300 to-[color:var(--gold)] transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <button
              onClick={() => canClaim && claimMilestone.mutate(next.tier)}
              disabled={!canClaim || claimMilestone.isPending}
              className={`relative w-full py-2.5 rounded-xl text-sm font-bold transition-all ${
                canClaim
                  ? "bg-gradient-to-r from-[color:var(--gold)] to-amber-400 text-black shadow-[0_6px_20px_-6px_rgba(212,175,55,0.7)] hover:brightness-110 active:scale-[0.98]"
                  : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
              } disabled:opacity-70`}
            >
              {canClaim ? (
                <span className="inline-flex items-center gap-1.5">
                  <Trophy className="w-4 h-4" />
                  {t("friends.milestone_claim")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  {t("friends.milestone_locked")}
                </span>
              )}
            </button>

            <p className="relative text-[10px] text-slate-400 text-center">{t("friends.milestone_active_hint")}</p>
          </div>
        );
      })()}


      {/* Referral link */}


      <div className="card-glass rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold">{t("friends.your_link")}</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 rounded-xl bg-background/50 border border-white/10 px-3 py-2.5 text-xs truncate">
            {inviteUrl}
          </div>
          <button
            onClick={copyInvite}
            className="shrink-0 h-9 w-9 rounded-xl bg-primary/20 text-primary flex items-center justify-center"
            aria-label={t("friends.copy")}
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <a
            href={telegramShareUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#229ED9] text-white font-semibold text-sm"
          >
            <Send className="w-4 h-4" />
            {t("friends.share_telegram")}
          </a>
          <button
            onClick={copyInvite}
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-muted text-foreground font-semibold text-sm"
          >
            <Copy className="w-4 h-4" />
            {t("friends.copy")}
          </button>
        </div>
      </div>

      {/* Friends list */}
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
                {p?.avatar_url || p?.telegram_id ? (
                  <img src={avatarSrc(p.avatar_url, p.telegram_id)} alt={name} referrerPolicy="no-referrer" className="w-9 h-9 rounded-full object-cover" />
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
  const giftListFn = useServerFn(listGiftBoxes);
  const { data: giftData } = useQuery({ queryKey: ["gift-boxes"], queryFn: () => giftListFn(), refetchInterval: 60_000 });
  const activeBonus = giftData?.activeBonus as { percent: number; expires_at: string } | null | undefined;
  const bonusPct = activeBonus ? Number(activeBonus.percent) : 0;

  // Reinvest
  const reinvestFn = useServerFn(reinvestBalance);
  const [reinvestAmount, setReinvestAmount] = useState("");
  const reinvestNum = Math.max(0, Number(reinvestAmount) || 0);
  const balance = Number(me.profile.balance ?? 0);
  const reinvest = useMutation({
    mutationFn: (amt: number) => reinvestFn({ data: { amount: amt } }),
    onSuccess: (r: any) => {
      toast.success(`+$${(r.usdPerDay ?? 0).toFixed(4)} USDT/day`);
      getTelegram()?.HapticFeedback?.impactOccurred("medium");
      setReinvestAmount("");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? t("common.failed")),
  });

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
      if (amountNum < 0.1) throw new Error(t("deposit.err_min"));
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
      <h2 className="text-2xl font-bold text-white text-glow-white">{t("deposit.title")}</h2>
      <p className="text-sm text-white/80">{t("deposit.subtitle")}</p>

      <ActiveBonusBanner />


      <div className="card-glass rounded-2xl p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("deposit.your_balance")}</span>
          <span className="font-semibold tabular-nums">{formatGram(me.profile.balance, 6)} GRAM</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("deposit.current_rate")}</span>
          <span className="font-semibold tabular-nums">{formatGram(Number((me.profile as any).mining_rate ?? 0), 6)} GRAM {t("mine.per_day_suffix")}</span>
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
            {t("deposit.amount_helper", { usdt: usdtValue.toFixed(2), daily: formatReward(amountNum * 0.033) })}
          </p>
        )}
        {amountNum > 0 && bonusPct > 0 && (
          <p className="text-[11px] mt-1 tabular-nums font-semibold text-amber-300 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            {t("deposit.bonus_hint", {
              percent: bonusPct.toFixed(1),
              extra: formatReward(amountNum * (bonusPct / 100)),
            })}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">{t("deposit.min_hint")}</p>
        {amountNum > 0 && amountNum < 0.1 && (
          <p className="text-[11px] text-[color:var(--danger)] mt-1">{t("deposit.err_min")}</p>
        )}
      </Field>

      <motion.button
        whileTap={{ scale: 0.97 }}
        disabled={pay.isPending || amountNum < 0.1 || !wallet}
        onClick={() => pay.mutate()}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary via-accent to-primary font-bold text-primary-foreground disabled:opacity-50 shadow-xl glow-primary"
      >
        {pay.isPending ? t("deposit.waiting") : wallet ? t("deposit.pay") : t("deposit.connect_to_deposit")}
      </motion.button>

      {/* Reinvest section — reinvest available GRAM balance to increase mining rate */}
      <div className="card-glass rounded-2xl p-4 space-y-3 mt-2">
        <h3 className="text-lg font-bold">{t("deposit.reinvest_title")}</h3>
        <p className="text-xs text-muted-foreground">{t("deposit.reinvest_subtitle")}</p>
        <Field label={t("deposit.reinvest_amount")}>
          <div className="relative">
            <input
              inputMode="decimal"
              value={reinvestAmount}
              onChange={(e) => setReinvestAmount(e.target.value)}
              placeholder="0.1"
              className="input pr-16 text-lg font-semibold"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">GRAM</span>
          </div>
          <div className="flex justify-between items-center mt-1">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {t("deposit.balance_label", { n: formatGram(balance, 4) })}
            </span>
            <button
              type="button"
              onClick={() => setReinvestAmount(String(Math.max(0, Math.floor(balance * 10000) / 10000)))}
              className="text-[11px] text-primary underline"
            >
              {t("deposit.max")}
            </button>
          </div>
        </Field>
        <div className="rounded-xl bg-primary/10 px-4 py-3 text-center">
          <p className="text-sm font-semibold tabular-nums">
            + {(reinvestNum * 0.033).toFixed(4)} GRAM {t("mine.per_day")}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.97 }}
          disabled={reinvest.isPending || reinvestNum < 0.1 || reinvestNum > balance}
          onClick={() => reinvest.mutate(reinvestNum)}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-primary via-accent to-primary font-bold text-primary-foreground disabled:opacity-50 shadow-lg"
        >
          {reinvest.isPending ? t("deposit.waiting") : t("deposit.reinvest_cta")}
        </motion.button>
        {reinvestNum > 0 && reinvestNum < 0.1 && (
          <p className="text-[11px] text-[color:var(--danger)] text-center">{t("deposit.reinvest_min")}</p>
        )}
        {reinvestNum > balance && (
          <p className="text-[11px] text-[color:var(--danger)] text-center">{t("deposit.reinvest_insufficient")}</p>
        )}
      </div>


      {!!deposits?.length && (
        <div className="card-glass rounded-2xl p-4">
          <p className="font-semibold mb-2">{t("common.history")}</p>
          <PaginatedList
            items={deposits}
            renderItem={(d: any) => (
              <div key={d.id} className="flex justify-between text-sm py-1.5">
                <span>{formatReward(Number(d.amount_ton))} GRAM</span>
                <span className="text-muted-foreground">{d.status}</span>
              </div>
            )}
          />
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
  const price = useTonPrice();
  const minGram = price > 0 ? 3 / price : 0;
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const { data: hist } = useQuery({ queryKey: ["withdrawals"], queryFn: () => lFn() });
  const amountNum = Number(amount);
  const amountInvalid = isNaN(amountNum) || amountNum <= 0 || (minGram > 0 && amountNum < minGram);
  const mut = useMutation({
    mutationFn: () => {
      if (amountInvalid) throw new Error(t("withdraw.min_error", { amount: formatGram(minGram) }));
      if (!address.trim()) throw new Error(t("withdraw.address"));
      return wFn({ data: { amount: amountNum, address } });
    },
    onSuccess: (r) => { toast.success(t("withdraw.requested_net", { amount: formatGram(r.net) })); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e?.message ?? t("common.failed")),
  });
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold text-white text-glow-white">{t("withdraw.title")}</h2>
      <p className="text-sm text-white/80">{t("withdraw.subtitle", { amount: formatGram(minGram) })}</p>
      <div className="card-glass rounded-2xl p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("withdraw.available")}</span>
          <span className="font-semibold tabular-nums">{formatGram(me.profile.balance, 6)} GRAM</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("withdraw.min_label")}</span>
          <span className="font-semibold">{minGram > 0 ? `${formatGram(minGram)} GRAM (~$3)` : "$3"}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("withdraw.fee_label")}</span>
          <span className="font-semibold">5%</span>
        </div>
        <Field label={t("withdraw.amount")}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          {amountInvalid && <p className="text-[10px] text-destructive mt-1">{t("withdraw.min_error", { amount: formatGram(minGram) })}</p>}
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
        {!!hist?.length && (
          <PaginatedList
            items={hist}
            renderItem={(w: any) => (
              <div key={w.id} className="flex justify-between text-sm py-1.5">
                <span>{formatGram(w.amount)} GRAM</span>
                <span className="text-muted-foreground">{w.status}</span>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}

function PaginatedList<T>({
  items,
  renderItem,
  pageSize = 10,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  pageSize?: number;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return (
    <>
      <div>{pageItems.map((it, i) => renderItem(it, start + i))}</div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 mt-2 border-t border-white/5">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={current === 1}
            className="px-3 py-1 rounded-lg text-xs bg-white/5 disabled:opacity-40"
          >
            ‹
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {current}/{totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={current === totalPages}
            className="px-3 py-1 rounded-lg text-xs bg-white/5 disabled:opacity-40"
          >
            ›
          </button>
        </div>
      )}
    </>
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

// ============ Stats (live trading report — Binance + MEXC) ============
// Binance covers most majors and the largest TON-ecosystem tokens (TON, NOT,
// DOGS, HMSTR, CATI, GRAM) via WebSocket. MEXC fills the gap for TON tokens
// that Binance does not list (MAJOR, X Empire, REDO, PX, GEMS, ANON) via
// REST polling every 5s — MEXC's public WS uses protobuf so a light polling
// loop is a much smaller integration for the same UX.
type TradeCoin = {
  symbol: string;        // display symbol (BTC, ETH, …)
  source: "binance" | "mexc";
  pair: string;          // exchange pair, e.g. BTCUSDT / MAJORUSDT
  logo: string;          // stable CDN logo URL
  decimals: number;
};

const MAX_STATS_ROWS = 10;

const STATS_COINS: TradeCoin[] = [
  // TON ecosystem — Binance
  { symbol: "TON",   source: "binance", pair: "TONUSDT",   decimals: 2, logo: "https://assets.coingecko.com/coins/images/17980/large/ton_symbol.png" },
  { symbol: "NOT",   source: "binance", pair: "NOTUSDT",   decimals: 5, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/28850.png" },
  { symbol: "DOGS",  source: "binance", pair: "DOGSUSDT",  decimals: 6, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/32698.png" },
  { symbol: "HMSTR", source: "binance", pair: "HMSTRUSDT", decimals: 5, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/32195.png" },
  { symbol: "CATI",  source: "binance", pair: "CATIUSDT",  decimals: 4, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/32966.png" },
  { symbol: "GRAM",  source: "binance", pair: "GRAMUSDT",  decimals: 2, logo: gramLogoImg.url },
  // TON ecosystem — MEXC (not listed on Binance)
  { symbol: "MAJOR", source: "mexc",    pair: "MAJORUSDT", decimals: 4, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/33179.png" },
  { symbol: "X",     source: "mexc",    pair: "XUSDT",     decimals: 6, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/32799.png" },
  { symbol: "REDO",  source: "mexc",    pair: "REDOUSDT",  decimals: 4, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/33888.png" },
  { symbol: "PX",    source: "mexc",    pair: "PXUSDT",    decimals: 5, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/33477.png" },
  { symbol: "GEMS",  source: "mexc",    pair: "GEMSUSDT",  decimals: 5, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/33083.png" },
  { symbol: "ANON",  source: "mexc",    pair: "ANONUSDT",  decimals: 4, logo: "https://s2.coinmarketcap.com/static/img/coins/128x128/32623.png" },
  // General market
  { symbol: "BTC",  source: "binance", pair: "BTCUSDT",  decimals: 0, logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png" },
  { symbol: "ETH",  source: "binance", pair: "ETHUSDT",  decimals: 0, logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png" },
  { symbol: "BNB",  source: "binance", pair: "BNBUSDT",  decimals: 1, logo: "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png" },
  { symbol: "SOL",  source: "binance", pair: "SOLUSDT",  decimals: 1, logo: "https://assets.coingecko.com/coins/images/4128/large/solana.png" },
  { symbol: "XRP",  source: "binance", pair: "XRPUSDT",  decimals: 4, logo: "https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png" },
  { symbol: "TRX",  source: "binance", pair: "TRXUSDT",  decimals: 4, logo: "https://assets.coingecko.com/coins/images/1094/large/tron-logo.png" },
  { symbol: "DOGE", source: "binance", pair: "DOGEUSDT", decimals: 4, logo: "https://assets.coingecko.com/coins/images/5/large/dogecoin.png" },
  { symbol: "ADA",  source: "binance", pair: "ADAUSDT",  decimals: 3, logo: "https://assets.coingecko.com/coins/images/975/large/cardano.png" },
  { symbol: "AVAX", source: "binance", pair: "AVAXUSDT", decimals: 2, logo: "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png" },
  { symbol: "LINK", source: "binance", pair: "LINKUSDT", decimals: 2, logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png" },
  { symbol: "MATIC", source: "binance", pair: "MATICUSDT", decimals: 4, logo: "https://assets.coingecko.com/coins/images/4713/large/polygon.png" },
  { symbol: "DOT",  source: "binance", pair: "DOTUSDT",  decimals: 3, logo: "https://assets.coingecko.com/coins/images/12171/large/polkadot.png" },
  { symbol: "LTC",  source: "binance", pair: "LTCUSDT",  decimals: 2, logo: "https://assets.coingecko.com/coins/images/2/large/litecoin.png" },
  { symbol: "BCH",  source: "binance", pair: "BCHUSDT",  decimals: 2, logo: "https://assets.coingecko.com/coins/images/780/large/bitcoin-cash-circle.png" },
  { symbol: "NEAR", source: "binance", pair: "NEARUSDT", decimals: 3, logo: "https://assets.coingecko.com/coins/images/10365/large/near.jpg" },
  { symbol: "ATOM", source: "binance", pair: "ATOMUSDT", decimals: 3, logo: "https://assets.coingecko.com/coins/images/1481/large/cosmos_hub.png" },
  { symbol: "UNI",  source: "binance", pair: "UNIUSDT",  decimals: 3, logo: "https://assets.coingecko.com/coins/images/12504/large/uniswap-logo.png" },
  { symbol: "APT",  source: "binance", pair: "APTUSDT",  decimals: 3, logo: "https://assets.coingecko.com/coins/images/26455/large/aptos_round.png" },
  { symbol: "ARB",  source: "binance", pair: "ARBUSDT",  decimals: 4, logo: "https://assets.coingecko.com/coins/images/16547/large/arb.jpg" },
  { symbol: "OP",   source: "binance", pair: "OPUSDT",   decimals: 3, logo: "https://assets.coingecko.com/coins/images/25244/large/Optimism.png" },
  { symbol: "SUI",  source: "binance", pair: "SUIUSDT",  decimals: 4, logo: "https://assets.coingecko.com/coins/images/26375/large/sui-ocean-square.png" },
  { symbol: "SEI",  source: "binance", pair: "SEIUSDT",  decimals: 4, logo: "https://assets.coingecko.com/coins/images/28205/large/Sei_Logo_-_Transparent.png" },
  { symbol: "INJ",  source: "binance", pair: "INJUSDT",  decimals: 2, logo: "https://assets.coingecko.com/coins/images/12882/large/Secondary_Symbol.png" },
  { symbol: "TIA",  source: "binance", pair: "TIAUSDT",  decimals: 3, logo: "https://assets.coingecko.com/coins/images/31967/large/tia.jpg" },
  { symbol: "FIL",  source: "binance", pair: "FILUSDT",  decimals: 3, logo: "https://assets.coingecko.com/coins/images/12817/large/filecoin.png" },
  { symbol: "ICP",  source: "binance", pair: "ICPUSDT",  decimals: 3, logo: "https://assets.coingecko.com/coins/images/14495/large/Internet_Computer_logo.png" },
  { symbol: "SHIB", source: "binance", pair: "SHIBUSDT", decimals: 8, logo: "https://assets.coingecko.com/coins/images/11939/large/shiba.png" },
  { symbol: "PEPE", source: "binance", pair: "PEPEUSDT", decimals: 8, logo: "https://assets.coingecko.com/coins/images/29850/large/pepe-token.jpeg" },
  { symbol: "WIF",  source: "binance", pair: "WIFUSDT",  decimals: 4, logo: "https://assets.coingecko.com/coins/images/33566/large/dogwifhat.jpg" },
  { symbol: "BONK", source: "binance", pair: "BONKUSDT", decimals: 8, logo: "https://assets.coingecko.com/coins/images/28600/large/bonk.jpg" },
  { symbol: "FLOKI",source: "binance", pair: "FLOKIUSDT",decimals: 6, logo: "https://assets.coingecko.com/coins/images/16746/large/PNG_image.png" },
  { symbol: "AAVE", source: "binance", pair: "AAVEUSDT", decimals: 2, logo: "https://assets.coingecko.com/coins/images/12645/large/AAVE.png" },
  { symbol: "RNDR", source: "binance", pair: "RNDRUSDT", decimals: 3, logo: "https://assets.coingecko.com/coins/images/11636/large/rndr.png" },
  { symbol: "FTM",  source: "binance", pair: "FTMUSDT",  decimals: 4, logo: "https://assets.coingecko.com/coins/images/4001/large/Fantom_round.png" },
  { symbol: "ALGO", source: "binance", pair: "ALGOUSDT", decimals: 4, logo: "https://assets.coingecko.com/coins/images/4380/large/download.png" },
  { symbol: "XLM",  source: "binance", pair: "XLMUSDT",  decimals: 4, logo: "https://assets.coingecko.com/coins/images/100/large/Stellar_symbol_black_RGB.png" },
  { symbol: "ETC",  source: "binance", pair: "ETCUSDT",  decimals: 2, logo: "https://assets.coingecko.com/coins/images/453/large/ethereum-classic-logo.png" },
];

const BINANCE_COINS = STATS_COINS.filter((c) => c.source === "binance");
const MEXC_COINS = STATS_COINS.filter((c) => c.source === "mexc");

type TickRow = {
  id: string;
  symbol: string;
  image: string | null;
  price: number;
  changePct: number;
  decimals: number;
};

function formatPrice(v: number, decimals: number) {
  const fixed = v.toFixed(decimals);
  const [ints, dec] = fixed.split(".");
  const withSep = ints.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec ? `${withSep}.${dec}` : withSep;
}

type MarketQuote = { price: number; changePct: number };
type MarketMap = Record<string, MarketQuote>;

// Initial snapshot from Binance REST — returns per-symbol quotes for Binance coins
async function fetchBinanceSnapshot(): Promise<MarketMap> {
  const symbolsParam = encodeURIComponent(
    JSON.stringify(BINANCE_COINS.map((c) => c.pair)),
  );
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data = (await res.json()) as Array<{
    symbol: string;
    lastPrice: string;
    priceChangePercent: string;
  }>;
  const map: MarketMap = {};
  for (const c of BINANCE_COINS) {
    const m = data.find((d) => d.symbol === c.pair);
    map[c.symbol] = {
      price: m ? parseFloat(m.lastPrice) : 0,
      changePct: m ? parseFloat(m.priceChangePercent) : 0,
    };
  }
  return map;
}

// MEXC snapshot via same-origin server proxy (MEXC does not send CORS headers,
// so a direct browser fetch is blocked). The proxy returns a compact map keyed
// by the exchange pair (e.g. MAJORUSDT) with `{ price, changePct }` already
// normalized to percent.
async function fetchMexcSnapshot(): Promise<MarketMap> {
  const map: MarketMap = {};
  if (MEXC_COINS.length === 0) return map;
  try {
    const symbols = MEXC_COINS.map((c) => c.pair).join(",");
    const res = await fetch(`/api/public/mexc-prices?symbols=${symbols}`);
    if (!res.ok) throw new Error(`mexc-prices ${res.status}`);
    const data = (await res.json()) as Record<
      string,
      { price: number; changePct: number }
    >;
    for (const c of MEXC_COINS) {
      const q = data[c.pair];
      map[c.symbol] = {
        price: q ? Number(q.price) : 0,
        changePct: q ? Number(q.changePct) : 0,
      };
    }
  } catch {
    for (const c of MEXC_COINS) map[c.symbol] = { price: 0, changePct: 0 };
  }
  return map;
}


// ============= Global Stats Stream (runs indefinitely, survives tab switches) =============
type StatsStoreState = { rows: TickRow[]; split: { long: number; short: number } };
const statsStore = (() => {
  let state: StatsStoreState = {
    rows: [],
    split: (() => {
      const long = 45 + Math.random() * 10;
      return { long, short: 100 - long };
    })(),
  };
  const listeners = new Set<() => void>();
  const market: MarketMap = {};
  let started = false;
  let ws: WebSocket | null = null;
  let feedId: ReturnType<typeof setInterval> | null = null;
  let splitId: ReturnType<typeof setInterval> | null = null;
  let nextCoinCursor = MAX_STATS_ROWS % STATS_COINS.length;

  function buildRow(
    coin: TradeCoin,
    basePrice: number,
    baseChange: number,
  ): TickRow {
    const drift = (Math.random() - 0.5) * 0.0015; // ±0.075%
    const changeDrift = (Math.random() - 0.5) * 0.05; // ±0.05 pp
    let changePct = baseChange + changeDrift;
    // Visual bias: the market snapshot can be overwhelmingly short, so we
    // nudge a portion of negative rows back to positive to keep the stats bar
    // looking balanced (long ~ short). This is cosmetic, not investment data.
    if (changePct < 0 && Math.random() < 0.42) {
      changePct = Math.abs(changePct) + Math.random() * 0.25;
    }
    return {
      id: coin.symbol,
      symbol: coin.symbol,
      image: coin.logo,
      price: basePrice * (1 + drift),
      changePct,
      decimals: coin.decimals,
    };
  }

  function emit() {
    for (const l of listeners) l();
  }
  function setState(next: StatsStoreState) {
    state = next;
    emit();
  }

  function getVisibleCoins(cursor: number) {
    return Array.from({ length: Math.min(MAX_STATS_ROWS, STATS_COINS.length) }, (_, i) => (
      STATS_COINS[(cursor + i) % STATS_COINS.length]
    ));
  }

  async function seedFromRest() {
    try {
      const [binance, mexc] = await Promise.all([
        fetchBinanceSnapshot(),
        fetchMexcSnapshot(),
      ]);
      Object.assign(market, binance, mexc);
    } catch { /* ignore, WS/poll will fill it */ }
  }

  let mexcPollId: ReturnType<typeof setInterval> | null = null;
  function startMexcPolling() {
    if (mexcPollId || MEXC_COINS.length === 0) return;
    mexcPollId = setInterval(async () => {
      if (!started) return;
      try {
        const snap = await fetchMexcSnapshot();
        Object.assign(market, snap);
      } catch { /* ignore transient failures */ }
    }, 5000);
  }

  function connectWs() {
    const streams = BINANCE_COINS.map((c) => `${c.pair.toLowerCase()}@ticker`).join("/");
    const bySymbol = new Map(BINANCE_COINS.map((c) => [c.pair, c]));
    try {
      ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    } catch {
      ws = null;
      return;
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const d = msg?.data;
        if (!d?.s) return;
        const coin = bySymbol.get(d.s);
        if (!coin) return;
        market[coin.symbol] = { price: parseFloat(d.c), changePct: parseFloat(d.P) };
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      // Auto-reconnect after a short delay so the stream truly runs forever
      setTimeout(() => { if (started) connectWs(); }, 3000);
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
  }

  function start() {
    if (started) return;
    started = true;
    seedFromRest();
    connectWs();
    startMexcPolling();


    feedId = setInterval(() => {
      if (state.rows.length === 0 && Object.keys(market).length === 0) return;

      if (state.rows.length === 0) {
        const coins = getVisibleCoins(0);
        const nextRows = coins.map((coin) => {
          const q = market[coin.symbol];
          return buildRow(
            coin,
            q ? q.price : 0,
            q ? q.changePct : 0,
          );
        });
        setState({ ...state, rows: nextRows });
        nextCoinCursor = MAX_STATS_ROWS % STATS_COINS.length;
      } else {
        // Add one fresh coin at the top on each tick, pushing the existing
        // rows down and dropping the last one — matching the reference motion.
        const currentRows = state.rows;
        const currentSymbols = new Set(currentRows.map((row) => row.symbol));
        let coin = STATS_COINS[nextCoinCursor % STATS_COINS.length];
        let guard = 0;
        while (currentSymbols.has(coin.symbol) && guard < STATS_COINS.length) {
          nextCoinCursor = (nextCoinCursor + 1) % STATS_COINS.length;
          coin = STATS_COINS[nextCoinCursor % STATS_COINS.length];
          guard += 1;
        }
        const q = market[coin.symbol];
        const newRow = buildRow(
          coin,
          q ? q.price : 0,
          q ? q.changePct : 0,
        );
        const nextRows = [newRow, ...currentRows].slice(0, MAX_STATS_ROWS);
        setState({ ...state, rows: nextRows });
        nextCoinCursor = (nextCoinCursor + 1) % STATS_COINS.length;
      }
    }, 1500);

    // splitId removed — the split is now derived from visible rows, so no
    // independent random interval is needed.
  }

  return {
    start,
    subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
    getSnapshot() { return state; },
  };
})();

function useStatsStream() {
  const [snap, setSnap] = useState(statsStore.getSnapshot());
  useEffect(() => {
    statsStore.start();
    const unsub = statsStore.subscribe(() => setSnap(statsStore.getSnapshot()));
    setSnap(statsStore.getSnapshot());
    return () => { unsub(); };
  }, []);
  return snap;
}

function StatsTab() {
  const { t } = useT();
  const { rows } = useStatsStream();
  // Keep the LONG/SHORT bar coherent with the visible rows. The buildRow
  // helper already applies a gentle bias, so this should now be balanced.
  const split = (() => {
    if (!rows.length) return { long: 50, short: 50 };
    const longCount = rows.filter((r) => r.changePct >= 0).length;
    const longPct = (longCount / rows.length) * 100;
    // Allow any real range from 5% to 95% so an outlier market can still show.
    const clamped = Math.max(5, Math.min(95, longPct));
    return { long: clamped, short: 100 - clamped };
  })();

  return (
    <div className="space-y-3 pb-4">
      {/* Intro card */}
      <div className="card-glass rounded-2xl p-4 space-y-3">
        <h2 className="font-bold text-base leading-snug">{t("stats.title")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("stats.desc")}</p>

        {/* LONG / SHORT split */}
        <div className="relative h-11 rounded-full overflow-hidden ring-1 ring-white/10 flex">
          <div
            className="h-full flex items-center justify-center text-white font-bold text-sm"
            style={{
              width: `${split.long}%`,
              background: "linear-gradient(90deg, #b6d4ff 0%, #7aa7ff 100%)",
            }}
          >
            <div className="text-center leading-tight">
              <div>{split.long.toFixed(2)}%</div>
              <div className="text-[10px] font-semibold opacity-90">{t("stats.long")}</div>
            </div>
          </div>
          <div
            className="h-full flex items-center justify-center text-white font-bold text-sm"
            style={{
              width: `${split.short}%`,
              background: "linear-gradient(90deg, #ff8a6e 0%, #ff4d2e 100%)",
            }}
          >
            <div className="text-center leading-tight">
              <div>{split.short.toFixed(2)}%</div>
              <div className="text-[10px] font-semibold opacity-90">{t("stats.short")}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Live rows */}
      <div className="space-y-2">
        {rows.map((r) => {
          const isLong = r.changePct >= 0;
          const pctStr = `${isLong ? "+" : ""}${r.changePct.toFixed(2)}%`;
          return (
            <div
              key={r.id}
              className="card-glass rounded-2xl px-3 py-3 grid grid-cols-[auto_1fr_auto_auto] items-center gap-2"
            >
                  {/* official logo */}
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center overflow-hidden shrink-0 ring-1 ring-white/10">
                    {r.image ? (
                      <img
                        src={r.image}
                        alt={r.symbol}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const el = e.currentTarget;
                          el.style.display = "none";
                          const parent = el.parentElement;
                          if (parent && !parent.querySelector("[data-fallback]")) {
                            const span = document.createElement("span");
                            span.setAttribute("data-fallback", "");
                            span.className = "text-xs font-bold";
                            span.textContent = r.symbol[0];
                            parent.appendChild(span);
                          }
                        }}
                      />
                    ) : (
                      <span className="text-xs font-bold">{r.symbol[0]}</span>
                    )}
                  </div>

                  {/* symbol + price */}
                  <div className="min-w-0 flex items-baseline gap-2">
                    <span className="font-bold text-sm">{r.symbol}</span>
                    <motion.span
                      key={`${r.symbol}-${r.price}`}
                      initial={{ color: isLong ? "#7aa7ff" : "#ff8a6e" }}
                      animate={{ color: "hsl(var(--muted-foreground))" }}
                      transition={{ duration: 0.6 }}
                      className="text-[13px] truncate"
                    >
                      $ {formatPrice(r.price, r.decimals)}
                    </motion.span>
                  </div>


                  {/* % change */}
                  <div
                    className="text-xs font-bold px-2 py-1 rounded-md text-foreground"
                    style={{
                      background: isLong
                        ? "linear-gradient(90deg, rgba(122,167,255,0.05), rgba(122,167,255,0.25))"
                        : "linear-gradient(90deg, rgba(255,138,110,0.05), rgba(255,77,46,0.25))",
                    }}
                  >
                    {pctStr}
                  </div>

                  {/* pill badge */}
                  <div
                    className="text-[11px] font-bold text-white px-3 py-1.5 rounded-full shrink-0"
                    style={{
                      background: isLong
                        ? "linear-gradient(90deg, #b6d4ff, #7aa7ff)"
                        : "linear-gradient(90deg, #ff8a6e, #ff4d2e)",
                    }}
                  >
                    {isLong ? t("stats.long") : t("stats.short")}
                  </div>
                </div>
              );
            })}

      </div>
    </div>
  );
}


function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { t } = useT();
  const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "mine", label: t("nav.mine"), icon: <Pickaxe className="w-5 h-5" /> },
    { id: "tasks", label: t("nav.tasks"), icon: <ListChecks className="w-5 h-5" /> },
    { id: "stats", label: t("nav.stats"), icon: <Activity className="w-5 h-5" /> },
    { id: "top", label: t("nav.top"), icon: <Trophy className="w-5 h-5" /> },
    { id: "friends", label: t("nav.friends"), icon: <Users className="w-5 h-5" /> },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40">
      <div className="max-w-md mx-auto px-3 pb-3">
        <div className="card-glass rounded-2xl px-1 py-2 flex justify-between">
          {items.map((it) => {
            const active = tab === it.id;
            return (
              <button key={it.id} onClick={() => { setTab(it.id); getTelegram()?.HapticFeedback?.impactOccurred("light"); }}
                className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition ${active ? "text-primary" : "text-muted-foreground"}`}>
                <div className={`p-1 rounded-lg ${active ? "bg-primary/15" : ""}`}>{it.icon}</div>
                <span className="text-[9px] font-medium truncate max-w-full px-0.5">{it.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}





type AdminSection = "overview" | "tasks" | "users";

function AdminTab() {
  const { t: tr } = useT();
  const statsFn = useServerFn(adminStats);
  const [section, setSection] = useState<AdminSection>("overview");

  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => statsFn(),
    refetchInterval: 20_000,
  });

  return (
    <div className="space-y-4 pb-4">
      {/* Sticky pro header */}
      <div className="sticky top-0 z-10 -mx-4 px-4 pt-2 pb-3 bg-background/85 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/30 to-accent/20 border border-primary/30 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="eyebrow text-muted-foreground !text-[9px]">Control Center</p>
              <h2 className="text-lg font-display font-bold leading-tight">{tr("admin.title")}</h2>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[color:var(--success)]/10 border border-[color:var(--success)]/20">
            <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--success)] animate-pulse" />
            <span className="text-[10px] font-semibold text-[color:var(--success)]">Live</span>
          </div>
        </div>

        {/* Segmented sub-nav */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-background/60 border border-white/5">
          {([
            { id: "overview", label: "Overview", icon: LayoutDashboard },
            { id: "tasks", label: "Tasks", icon: ListChecks },
            { id: "users", label: "Users", icon: Users },
          ] as { id: AdminSection; label: string; icon: any }[]).map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                  active
                    ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {section === "overview" && <AdminOverview stats={stats} tr={tr} />}
      {section === "tasks" && <AdminTasksSection tr={tr} />}
      {section === "users" && <AdminUsersSection />}
    </div>
  );
}

function AdminKPI({
  label,
  value,
  sub,
  icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: "primary" | "info" | "gold" | "accent";
}) {
  const toneMap: Record<string, string> = {
    primary: "from-primary/25 to-primary/5 border-primary/25 text-primary",
    info: "from-[color:var(--info)]/25 to-[color:var(--info)]/5 border-[color:var(--info)]/25 text-[color:var(--info)]",
    gold: "from-[color:var(--gold)]/25 to-[color:var(--gold)]/5 border-[color:var(--gold)]/25 text-[color:var(--gold)]",
    accent: "from-accent/25 to-accent/5 border-accent/25 text-accent",
  };
  return (
    <div className="card-glass rounded-2xl p-3.5 relative overflow-hidden">
      <div className={`absolute -top-6 -right-6 w-20 h-20 rounded-full bg-gradient-to-br ${toneMap[tone]} opacity-40 blur-2xl`} />
      <div className="relative">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${toneMap[tone]} border flex items-center justify-center mb-2`}>
          {icon}
        </div>
        <p className="eyebrow text-muted-foreground !text-[9px] mb-0.5">{label}</p>
        <p className="font-display text-lg font-bold tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function AdminOverview({ stats, tr }: { stats: any; tr: (k: string, p?: any) => string }) {
  const kpis = [
    {
      label: tr("admin.users"),
      value: String(stats?.users ?? 0),
      sub: tr("admin.tasks_today", { n: stats?.completedToday ?? 0 }),
      icon: <Users className="w-4 h-4" />,
      tone: "primary" as const,
    },
    {
      label: tr("admin.deposits"),
      value: `${(stats?.deposits.totalTon ?? 0).toFixed(2)} TON`,
      sub: tr("admin.confirmed", { n: stats?.deposits.confirmed ?? 0 }),
      icon: <ArrowDownToLine className="w-4 h-4" />,
      tone: "info" as const,
    },
    {
      label: tr("admin.withdrawals"),
      value: formatGram(stats?.withdrawals.totalGram ?? 0),
      sub: tr("admin.pending", { n: stats?.withdrawals.pending ?? 0 }),
      icon: <ArrowUpFromLine className="w-4 h-4" />,
      tone: "gold" as const,
    },
    {
      label: tr("admin.mining_rate"),
      value: `${formatGram(stats?.totals.miningRate ?? 0)}/d`,
      sub: tr("admin.balances", { n: formatGram(stats?.totals.balance ?? 0) }),
      icon: <Sparkles className="w-4 h-4" />,
      tone: "accent" as const,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        {kpis.map((k) => <AdminKPI key={k.label} {...k} />)}
      </div>

      {/* Health summary strip */}
      <div className="card-glass rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[color:var(--success)]" />
            <p className="font-semibold text-sm">System status</p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--success)]/10 text-[color:var(--success)] font-semibold border border-[color:var(--success)]/20">
            All operational
          </span>
        </div>
        <div className="space-y-2">
          <HealthRow label="Deposit verification" hint="Every 2 minutes" ok />
          <HealthRow label="Withdrawal processing" hint="Every 2 minutes" ok />
          <HealthRow label="Daily gift broadcast" hint="12:00 UTC" ok />
        </div>
      </div>
    </div>
  );
}

function HealthRow({ label, hint, ok }: { label: string; hint: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <Circle className={`w-2 h-2 fill-current ${ok ? "text-[color:var(--success)]" : "text-destructive"}`} />
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{label}</p>
          <p className="text-[10px] text-muted-foreground truncate">{hint}</p>
        </div>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

function AdminTasksSection({ tr }: { tr: (k: string, p?: any) => string }) {
  const listFn = useServerFn(adminListTasks);
  const saveFn = useServerFn(adminSaveTask);
  const delFn = useServerFn(adminDeleteTask);
  const qc = useQueryClient();

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

  const kindTone: Record<string, string> = {
    daily: "bg-[color:var(--info)]/15 text-[color:var(--info)] border-[color:var(--info)]/25",
    once: "bg-primary/15 text-primary border-primary/25",
    channel: "bg-accent/15 text-accent border-accent/25",
    group: "bg-[color:var(--gold)]/15 text-[color:var(--gold)] border-[color:var(--gold)]/25",
  };

  return (
    <div className="space-y-3">
      {/* Form card */}
      <div className="card-glass rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-background/30">
          <p className="font-semibold flex items-center gap-2 text-sm">
            {editing ? <Pencil className="w-3.5 h-3.5 text-primary" /> : <Plus className="w-3.5 h-3.5 text-primary" />}
            {editing ? tr("admin.edit_task") : tr("admin.new_task")}
          </p>
          {editing && (
            <button onClick={() => setForm(empty)} className="text-[10px] text-muted-foreground hover:text-foreground">
              {tr("common.cancel")}
            </button>
          )}
        </div>

        <div className="p-4 space-y-3">
          <AdminField label={tr("admin.title_ph")}>
            <input
              className="w-full bg-background/60 rounded-lg px-3 py-2 text-sm border border-white/5 focus:border-primary/40 outline-none transition"
              placeholder={tr("admin.title_ph")}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </AdminField>

          <div className="grid grid-cols-2 gap-2.5">
            <AdminField label={tr("admin.code_ph")}>
              <input
                className="w-full bg-background/60 rounded-lg px-3 py-2 text-sm border border-white/5 focus:border-primary/40 outline-none transition font-mono"
                placeholder={tr("admin.code_ph")}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </AdminField>
            <AdminField label="Kind">
              <select
                className="w-full bg-background/60 rounded-lg px-3 py-2 text-sm border border-white/5 focus:border-primary/40 outline-none transition"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as any })}
              >
                <option value="daily">{tr("admin.kind.daily")}</option>
                <option value="once">{tr("admin.kind.once")}</option>
                <option value="channel">{tr("admin.kind.channel")}</option>
                <option value="group">{tr("admin.kind.group")}</option>
              </select>
            </AdminField>
            <AdminField label={tr("admin.reward_ph")}>
              <input
                className="w-full bg-background/60 rounded-lg px-3 py-2 text-sm border border-white/5 focus:border-primary/40 outline-none transition tabular-nums"
                type="number" step="0.0001"
                placeholder={tr("admin.reward_ph")}
                value={form.reward}
                onChange={(e) => setForm({ ...form, reward: Number(e.target.value) })}
              />
            </AdminField>
            <AdminField label={tr("admin.min_deposit_ph")}>
              <input
                className="w-full bg-background/60 rounded-lg px-3 py-2 text-sm border border-white/5 focus:border-primary/40 outline-none transition tabular-nums"
                type="number" step="0.01"
                placeholder={tr("admin.min_deposit_ph")}
                value={form.min_deposit}
                onChange={(e) => setForm({ ...form, min_deposit: Number(e.target.value) })}
              />
            </AdminField>
          </div>

          <AdminField label={tr("admin.desc_ph")}>
            <input
              className="w-full bg-background/60 rounded-lg px-3 py-2 text-sm border border-white/5 focus:border-primary/40 outline-none transition"
              placeholder={tr("admin.desc_ph")}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </AdminField>

          {(form.kind === "channel" || form.kind === "group") && (
            <div className="rounded-xl bg-background/30 border border-white/5 p-3 space-y-2.5">
              <p className="eyebrow !text-[9px] text-muted-foreground">Telegram target</p>
              <AdminField label={tr("admin.target_chat_ph")}>
                <input
                  className="w-full bg-background/60 rounded-lg px-3 py-2 text-sm border border-white/5 focus:border-primary/40 outline-none transition font-mono"
                  placeholder={tr("admin.target_chat_ph")}
                  value={form.target_chat}
                  onChange={(e) => setForm({ ...form, target_chat: e.target.value })}
                />
              </AdminField>
              <AdminField label={tr("admin.link_ph")}>
                <input
                  className="w-full bg-background/60 rounded-lg px-3 py-2 text-sm border border-white/5 focus:border-primary/40 outline-none transition"
                  placeholder={tr("admin.link_ph")}
                  value={form.link}
                  onChange={(e) => setForm({ ...form, link: e.target.value })}
                />
              </AdminField>
              <p className="text-[10px] text-muted-foreground leading-relaxed">{tr("admin.bot_note")}</p>
            </div>
          )}

          <label className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-background/40 border border-white/5">
            <span className="text-xs font-medium">{tr("admin.active")}</span>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="w-4 h-4 accent-primary"
            />
          </label>

          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.title || !form.code}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-primary to-accent font-semibold text-primary-foreground text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
          >
            {save.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {tr("admin.saving")}</>
              : editing ? tr("admin.save_changes") : tr("admin.create_task")}
          </button>
        </div>
      </div>

      {/* Tasks list */}
      <div className="card-glass rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-background/30">
          <div className="flex items-center gap-2">
            <ListChecks className="w-3.5 h-3.5 text-primary" />
            <p className="font-semibold text-sm">Tasks</p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-background/60 border border-white/5 tabular-nums font-semibold text-muted-foreground">
            {tasks?.length ?? 0}
          </span>
        </div>
        <div className="divide-y divide-white/5">
          {tasks?.map((t: any) => (
            <div key={t.id} className="px-4 py-3 flex items-start gap-3 hover:bg-background/30 transition">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm truncate">{t.title}</p>
                  <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border font-bold ${kindTone[t.kind] ?? "bg-muted text-muted-foreground border-white/10"}`}>
                    {t.kind}
                  </span>
                  {!t.is_active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-white/10 bg-muted text-muted-foreground uppercase tracking-wide font-bold">
                      {tr("common.off")}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  <span className="font-mono">{t.code}</span> · ${Number(t.reward).toFixed(4)} → +${(Number(t.reward) * 0.033).toFixed(6)} USDT/d
                  {t.target_chat ? ` · ${t.target_chat}` : ""}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  className="p-1.5 rounded-lg bg-background/60 border border-white/5 hover:border-primary/40 transition"
                  onClick={() => setForm({
                    id: t.id, code: t.code, title: t.title, description: t.description ?? "",
                    reward: Number(t.reward), kind: t.kind, min_deposit: Number(t.min_deposit ?? 0),
                    link: t.link ?? "", target_chat: t.target_chat ?? "", is_active: !!t.is_active,
                  })}
                  aria-label="Edit"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  className="p-1.5 rounded-lg bg-background/60 border border-white/5 hover:border-destructive/40 text-destructive transition"
                  onClick={() => { if (confirm(tr("admin.delete_confirm"))) remove.mutate(t.id); }}
                  aria-label="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
          {!tasks?.length && (
            <p className="text-xs text-muted-foreground text-center py-8">{tr("admin.no_tasks")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="eyebrow !text-[9px] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function AdminUsersSection() {
  const listFn = useServerFn(adminListUsers);
  const detailFn = useServerFn(adminUserDetails);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users", debounced],
    queryFn: () => listFn({ data: { search: debounced || undefined, limit: 200 } }),
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ["admin-user", selected],
    queryFn: () => detailFn({ data: { user_id: selected! } }),
    enabled: !!selected,
  });

  if (selected) {
    return (
      <div className="card-glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg card-glass" aria-label="Volver">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <p className="font-semibold flex items-center gap-2">
            <UserCircle2 className="w-4 h-4 text-primary" /> Detalles del usuario
          </p>
        </div>
        {loadingDetail || !detail ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {detail.profile.avatar_url || detail.profile.telegram_id ? (
                <img src={avatarSrc(detail.profile.avatar_url, detail.profile.telegram_id)} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <UserCircle2 className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">
                  {detail.profile.first_name || detail.profile.username || "—"}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {detail.profile.username ? `@${detail.profile.username} · ` : ""}
                  TG {detail.profile.telegram_id ?? "—"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <StatMini label="Minería" value={`$${Number(detail.profile.mining_rate_usd ?? 0).toFixed(4)}/día`} />
              <StatMini label="Balance" value={`${formatGram(Number(detail.profile.balance ?? 0))} GRAM`} />
              <StatMini label="Rate GRAM" value={`${formatGram(Number(detail.profile.mining_rate ?? 0))}/día`} />
              <StatMini label="Depositado" value={`${Number(detail.profile.deposit_total ?? 0).toFixed(4)} TON`} />
              <StatMini label="Depósitos" value={`${detail.totals.depositsConfirmed}/${detail.totals.depositsCount} · ${detail.totals.depositsTonConfirmed.toFixed(4)} TON`} />
              <StatMini label="Retiros" value={`${detail.totals.withdrawalsPaid}/${detail.totals.withdrawalsCount} · ${formatGram(detail.totals.withdrawalsGramPaid)}`} />
              <StatMini label="Referidos" value={`${detail.totals.referralsCount} · +${formatGram(detail.totals.referralBonusTotal)}`} />
              <StatMini label="Tareas hechas" value={String(detail.totals.tasksCompleted)} />
            </div>

            <DetailList title={`Depósitos (${detail.deposits.length})`} empty="Sin depósitos">
              {detail.deposits.slice(0, 20).map((d: any) => (
                <div key={d.id} className="flex justify-between text-[11px] py-1 border-b border-white/5 last:border-0">
                  <span className="truncate">{new Date(d.created_at).toLocaleDateString()} · {d.status}</span>
                  <span className="tabular-nums font-semibold">{Number(d.amount_ton).toFixed(4)} TON</span>
                </div>
              ))}
            </DetailList>

            <DetailList title={`Retiros (${detail.withdrawals.length})`} empty="Sin retiros">
              {detail.withdrawals.slice(0, 20).map((w: any) => (
                <div key={w.id} className="flex justify-between text-[11px] py-1 border-b border-white/5 last:border-0">
                  <span className="truncate">{new Date(w.created_at).toLocaleDateString()} · {w.status}</span>
                  <span className="tabular-nums font-semibold">{formatGram(Number(w.amount))} GRAM</span>
                </div>
              ))}
            </DetailList>

            <DetailList title={`Referidos (${detail.referrals.length})`} empty="Sin referidos">
              {detail.referrals.slice(0, 30).map((r: any) => (
                <div key={r.referred_id} className="flex justify-between items-center text-[11px] py-1 border-b border-white/5 last:border-0">
                  <button
                    onClick={() => setSelected(r.referred_id)}
                    className="truncate underline-offset-2 hover:underline text-left"
                  >
                    {r.first_name || (r.username ? `@${r.username}` : r.referred_id.slice(0, 8))}
                  </button>
                  <span className="tabular-nums text-muted-foreground">
                    ${r.mining_rate_usd.toFixed(4)}/d · {r.deposit_total.toFixed(2)} TON
                  </span>
                </div>
              ))}
            </DetailList>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card-glass rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-background/30">
        <p className="font-semibold flex items-center gap-2 text-sm">
          <Users className="w-3.5 h-3.5 text-primary" /> Users
        </p>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-background/60 border border-white/5 tabular-nums font-semibold text-muted-foreground">
          {users?.length ?? 0}
        </span>
      </div>
      <div className="p-3 space-y-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search username, name or Telegram ID…"
            className="w-full bg-background/60 rounded-lg pl-8 pr-3 py-2 text-sm border border-white/5 focus:border-primary/40 outline-none transition"
          />
        </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-2 max-h-[70vh] overflow-y-auto">
          {users?.map((u: any, i: number) => (
            <button
              key={u.user_id}
              onClick={() => setSelected(u.user_id)}
              className="w-full rounded-xl bg-background/40 p-3 flex items-center gap-3 text-left hover:bg-background/60 transition"
            >
              <div className="w-6 text-[11px] font-bold text-muted-foreground tabular-nums text-center">
                {i + 1}
              </div>
              {u.avatar_url || u.telegram_id ? (
                <img src={avatarSrc(u.avatar_url, u.telegram_id)} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <UserCircle2 className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {u.first_name || (u.username ? `@${u.username}` : u.user_id.slice(0, 8))}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {u.username ? `@${u.username} · ` : ""}
                  {Number(u.deposit_total ?? 0).toFixed(2)} TON depositado
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-[color:var(--success)] tabular-nums">
                  ${Number(u.mining_rate_usd ?? 0).toFixed(4)}/d
                </p>
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {formatGram(Number(u.balance ?? 0))} GRAM
                </p>
              </div>
            </button>
          ))}
          {!users?.length && <p className="text-xs text-muted-foreground text-center py-4">Sin resultados</p>}
        </div>
      )}
      </div>
    </div>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background/40 p-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xs font-bold tabular-nums truncate">{value}</p>
    </div>
  );
}

function DetailList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  const hasContent = arr.filter(Boolean).length > 0;
  return (
    <div className="rounded-xl bg-background/40 p-3">
      <p className="text-xs font-semibold mb-1">{title}</p>
      {hasContent ? <div>{children}</div> : <p className="text-[11px] text-muted-foreground">{empty}</p>}
    </div>
  );
}
