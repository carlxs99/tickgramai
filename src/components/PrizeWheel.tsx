import { useMemo, useRef, useState } from "react";
import { motion, useAnimation } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Loader2, Sparkles, Ticket } from "lucide-react";
import { toast } from "sonner";
import { listWheelSpins, spinWheel } from "@/lib/wheel.functions";

type Segment = { key: string; label: string; sub: string; tone: "gram" | "bonus" | "box" | "spin" };

// Visual wheel layout (12 slices). The real prize is decided server-side;
// the wheel just animates to the matching slice.
const SEGMENTS: Segment[] = [
  { key: "gram-0.1", label: "0.1", sub: "GRAM", tone: "gram" },
  { key: "bonus-10", label: "+10%", sub: "bonus", tone: "bonus" },
  { key: "gram-0.2", label: "0.2", sub: "GRAM", tone: "gram" },
  { key: "box", label: "🎁", sub: "box", tone: "box" },
  { key: "gram-0.3", label: "0.3", sub: "GRAM", tone: "gram" },
  { key: "gram-1", label: "1", sub: "GRAM", tone: "gram" },
  { key: "gram-0.1b", label: "0.1", sub: "GRAM", tone: "gram" },
  { key: "spin", label: "🎰", sub: "+1 spin", tone: "spin" },
  { key: "gram-0.5", label: "0.5", sub: "GRAM", tone: "gram" },
  { key: "gram-2", label: "2", sub: "GRAM", tone: "gram" },
  { key: "bonus-25", label: "+25%", sub: "bonus", tone: "bonus" },
  { key: "gram-big", label: "5-10", sub: "GRAM", tone: "gram" },
];

const SLICE = 360 / SEGMENTS.length;

function segmentIndexFor(prizeType: string, amount: number): number {
  if (prizeType === "gift_box") return 3;
  if (prizeType === "extra_spin") return 7;
  if (prizeType === "deposit_bonus_pct") return amount >= 20 ? 10 : 1;
  const map: Record<string, number> = {
    "0.1": 0,
    "0.2": 2,
    "0.3": 4,
    "0.5": 8,
    "1": 5,
    "2": 9,
    "5": 11,
    "10": 11,
  };
  return map[String(amount)] ?? 0;
}

function toneColor(tone: Segment["tone"], i: number) {
  if (tone === "bonus") return "rgba(245, 158, 11, 0.85)";
  if (tone === "box") return "rgba(16, 185, 129, 0.85)";
  if (tone === "spin") return "rgba(168, 85, 247, 0.85)";
  return i % 2 === 0 ? "rgba(14, 165, 233, 0.75)" : "rgba(30, 64, 175, 0.85)";
}

export function PrizeWheelCard() {
  const listFn = useServerFn(listWheelSpins);
  const spinFn = useServerFn(spinWheel);
  const qc = useQueryClient();
  const controls = useAnimation();
  const rotationRef = useRef(0);
  const [spinning, setSpinning] = useState(false);
  const [prize, setPrize] = useState<null | { prizeType: string; prizeAmount: number }>(null);

  const { data } = useQuery({
    queryKey: ["wheel-spins"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
  });

  const spins = data?.spins ?? 0;
  const nextExpiryAt = data?.nextExpiryAt ?? null;

  const background = useMemo(() => {
    const stops = SEGMENTS.map((s, i) => {
      const from = i * SLICE;
      const to = (i + 1) * SLICE;
      return `${toneColor(s.tone, i)} ${from}deg ${to}deg`;
    });
    return `conic-gradient(from 0deg, ${stops.join(", ")})`;
  }, []);

  async function handleSpin() {
    if (spinning || spins <= 0) return;
    setSpinning(true);
    setPrize(null);
    try {
      const res = await spinFn();
      const idx = segmentIndexFor(res.prizeType, res.prizeAmount);
      // Pointer sits at the top (0deg). Land the slice center under it.
      const target = 360 - (idx * SLICE + SLICE / 2);
      const full = 6 * 360;
      const next = rotationRef.current + full + ((target - (rotationRef.current % 360)) + 360) % 360;
      rotationRef.current = next;
      await controls.start({
        rotate: next,
        transition: { duration: 4.2, ease: [0.15, 0.9, 0.2, 1] },
      });
      setPrize({ prizeType: res.prizeType, prizeAmount: res.prizeAmount });
      qc.invalidateQueries({ queryKey: ["wheel-spins"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["gift-boxes"] });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      toast.error(msg.includes("no spins") ? "No spins available" : "Spin failed, try again");
    } finally {
      setSpinning(false);
    }
  }

  const prizeText = (() => {
    if (!prize) return null;
    if (prize.prizeType === "gram_mining")
      return {
        title: `+${prize.prizeAmount} GRAM mining power`,
        sub: `Adds +${(prize.prizeAmount * 0.033).toFixed(4)} GRAM/day forever`,
      };
    if (prize.prizeType === "deposit_bonus_pct")
      return { title: `+${prize.prizeAmount}% deposit bonus`, sub: "Valid for your next deposit (48h)" };
    if (prize.prizeType === "gift_box") return { title: "Free gift box!", sub: "Open it in the gift box section" };
    return { title: "Extra spin!", sub: "One more free spin added" };
  })();

  return (
    <div className="glass-card rounded-3xl p-4 border border-white/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-sky-200">
          <Sparkles className="w-3 h-3" /> Prize Wheel
        </div>
        <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-bold text-white">
          <Ticket className="w-3 h-3" /> {spins}
        </div>
      </div>

      <p className="mt-1 text-[11px] text-white/70">
        Earn 1 free spin for every $10 in a single deposit. Prizes from 0.1 to 10 GRAM of mining power.
      </p>

      <div className="mt-4 flex flex-col items-center">
        <div className="relative" style={{ width: 240, height: 240 }}>
          {/* pointer */}
          <div className="absolute left-1/2 -top-1 z-20 -translate-x-1/2">
            <div className="h-0 w-0 border-x-[10px] border-x-transparent border-t-[16px] border-t-amber-300 drop-shadow" />
          </div>

          <motion.div
            animate={controls}
            className="absolute inset-0 rounded-full border-4 border-white/20 shadow-2xl"
            style={{ background }}
          >
            {SEGMENTS.map((s, i) => {
              const angle = i * SLICE + SLICE / 2;
              return (
                <div
                  key={s.key}
                  className="absolute left-1/2 top-1/2 origin-top"
                  style={{ transform: `rotate(${angle}deg) translate(-50%, 8px)` }}
                >
                  <div className="flex w-16 flex-col items-center text-center leading-none">
                    <span className="text-[13px] font-black text-white drop-shadow">{s.label}</span>
                    <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-wider text-white/80">
                      {s.sub}
                    </span>
                  </div>
                </div>
              );
            })}
          </motion.div>

          <div className="absolute left-1/2 top-1/2 z-10 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white/30 bg-[#0b1225] shadow-inner" />
        </div>

        <button
          onClick={handleSpin}
          disabled={spinning || spins <= 0}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {spinning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Spinning…
            </>
          ) : spins > 0 ? (
            <>Spin now ({spins})</>
          ) : (
            <>Deposit $10 to unlock a spin</>
          )}
        </button>

        {nextExpiryAt && spins > 0 && (
          <div className="mt-2 text-[10px] text-white/60">
            Spins expire on {new Date(nextExpiryAt).toLocaleDateString()}
          </div>
        )}

        {prizeText && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 w-full rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 text-center"
          >
            <div className="text-sm font-black text-amber-200">{prizeText.title}</div>
            <div className="text-[11px] text-white/70">{prizeText.sub}</div>
          </motion.div>
        )}

        {!!data?.history?.length && (
          <div className="mt-3 w-full space-y-1">
            {data.history.slice(0, 3).map((h) => (
              <div key={h.id} className="flex items-center justify-between text-[10px] text-white/60">
                <span>
                  {h.prize_type === "gram_mining"
                    ? `+${h.prize_amount} GRAM mining`
                    : h.prize_type === "deposit_bonus_pct"
                      ? `+${h.prize_amount}% deposit bonus`
                      : h.prize_type === "gift_box"
                        ? "Gift box"
                        : "Extra spin"}
                </span>
                <span>{h.used_at ? new Date(h.used_at).toLocaleDateString() : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact, graphic entry card for the Prize Wheel — visually matching the
 * gift boxes card. Tapping it opens the full wheel page.
 */
export function WheelTeaserCard({ onClick }: { onClick: () => void }) {
  const listFn = useServerFn(listWheelSpins);
  const { data } = useQuery({
    queryKey: ["wheel-spins"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
  });
  const spins = data?.spins ?? 0;

  const background = useMemo(() => {
    const stops = SEGMENTS.map((s, i) => `${toneColor(s.tone, i)} ${i * SLICE}deg ${(i + 1) * SLICE}deg`);
    return `conic-gradient(from 0deg, ${stops.join(", ")})`;
  }, []);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative w-full text-left rounded-3xl p-5 overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, oklch(0.24 0.08 300) 0%, oklch(0.30 0.10 280) 55%, oklch(0.42 0.14 250) 100%)",
      }}
    >
      <div className="absolute -bottom-10 -left-8 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />

      <div className="relative flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: 84, height: 84 }}>
          <motion.div
            className="absolute inset-0 rounded-full blur-2xl"
            animate={spins > 0 ? { opacity: [0.45, 0.85, 0.45], scale: [0.92, 1.1, 0.92] } : { opacity: 0.35 }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            style={{ background: "radial-gradient(circle, rgba(56,189,248,0.9) 0%, rgba(99,102,241,0.4) 45%, transparent 72%)" }}
          />
          <div className="absolute left-1/2 -top-1 z-20 -translate-x-1/2">
            <div className="h-0 w-0 border-x-[7px] border-x-transparent border-t-[12px] border-t-amber-300 drop-shadow" />
          </div>
          <motion.div
            className="absolute inset-0 rounded-full border-[3px] border-white/25 shadow-xl"
            style={{ background }}
            animate={{ rotate: 360 }}
            transition={{ duration: spins > 0 ? 9 : 26, repeat: Infinity, ease: "linear" }}
          />
          <div className="absolute left-1/2 top-1/2 z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/30 bg-[#0b1225]" />
          {spins > 0 && (
            <div className="absolute -bottom-1 -right-1 z-20 min-w-[22px] h-[22px] px-1 grid place-items-center rounded-full bg-amber-300 text-purple-950 text-[11px] font-black shadow-lg">
              {spins}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1 text-[10px] font-bold tracking-widest text-sky-200 uppercase">
            <Sparkles className="w-3 h-3" /> Prize Wheel
          </div>
          <div className="text-lg font-extrabold text-white leading-tight mt-0.5">
            {spins > 0 ? `You have ${spins} spin${spins === 1 ? "" : "s"}!` : "Spin & win GRAM"}
          </div>
          <div className="text-[11px] text-white/70 mt-0.5">
            1 free spin for every $10 in a single deposit.
          </div>
          <div className="text-[11px] font-bold text-amber-200 mt-0.5">
            Prizes from 0.1 to 10 GRAM mining power
          </div>
        </div>

        <ChevronRight className="w-5 h-5 text-white/70 shrink-0" />
      </div>

      <div className="relative mt-4 w-full py-3 rounded-2xl font-bold text-sm bg-white text-purple-900 shadow-lg flex items-center justify-center gap-2">
        <Ticket className="w-4 h-4" />
        {spins > 0 ? `Open the wheel (${spins})` : "Open the wheel"}
      </div>
    </motion.button>
  );
}
