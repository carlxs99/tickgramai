import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Pickaxe, Gift, Users, ArrowDownToLine, ArrowUpFromLine, ListChecks, Sparkles, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useT } from "@/i18n";

const STORAGE_KEY = "tickgram.tutorial.seen.v1";
const OPEN_EVENT = "tickgram:open-tutorial";

export function openTutorial() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_EVENT));
}

type SlideDef = {
  icon: React.ReactNode;
  titleKey: string;
  bodyKey: string;
  accent: string;
};

const SLIDES: SlideDef[] = [
  { icon: <Sparkles className="w-10 h-10" />, titleKey: "tutorial.s1.title", bodyKey: "tutorial.s1.body", accent: "from-primary to-accent" },
  { icon: <Pickaxe className="w-10 h-10" />, titleKey: "tutorial.s2.title", bodyKey: "tutorial.s2.body", accent: "from-amber-400 to-orange-500" },
  { icon: <ArrowDownToLine className="w-10 h-10" />, titleKey: "tutorial.s3.title", bodyKey: "tutorial.s3.body", accent: "from-sky-400 to-blue-600" },
  { icon: <Gift className="w-10 h-10" />, titleKey: "tutorial.s4.title", bodyKey: "tutorial.s4.body", accent: "from-yellow-400 to-amber-600" },
  { icon: <ListChecks className="w-10 h-10" />, titleKey: "tutorial.s5.title", bodyKey: "tutorial.s5.body", accent: "from-emerald-400 to-teal-600" },
  { icon: <Users className="w-10 h-10" />, titleKey: "tutorial.s6.title", bodyKey: "tutorial.s6.body", accent: "from-fuchsia-400 to-purple-600" },
  { icon: <ArrowUpFromLine className="w-10 h-10" />, titleKey: "tutorial.s7.title", bodyKey: "tutorial.s7.body", accent: "from-rose-400 to-red-600" },
];

export function OnboardingTutorial() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    setMounted(true);
    // Show automatically on first visit
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        // Small delay so the app renders first
        const to = setTimeout(() => setOpen(true), 900);
        return () => clearTimeout(to);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const onOpen = () => { setI(0); setOpen(true); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = () => {
    setOpen(false);
    try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch {}
  };

  if (!mounted || !open) return null;

  const last = i === SLIDES.length - 1;
  const s = SLIDES[i];

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center px-4">
      <button
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="relative w-full max-w-md rounded-3xl overflow-hidden bg-card text-card-foreground border border-border shadow-2xl"
      >
        <button
          onClick={close}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white/90"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header art */}
        <div className={`relative h-40 bg-gradient-to-br ${s.accent} flex items-center justify-center overflow-hidden`}>
          <motion.div
            className="absolute inset-0"
            animate={{ backgroundPosition: ["0% 0%", "100% 100%"] }}
            transition={{ duration: 8, repeat: Infinity, repeatType: "reverse" }}
            style={{
              backgroundImage: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.35), transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.25), transparent 45%)",
              backgroundSize: "200% 200%",
            }}
          />
          <AnimatePresence mode="wait">
            <motion.div
              key={i}
              initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
              className="relative text-white drop-shadow-lg"
            >
              {s.icon}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Body */}
        <div className="px-6 pt-5 pb-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                {t("tutorial.step_label", { current: i + 1, total: SLIDES.length })}
              </p>
              <h2 className="text-xl font-bold leading-tight">{t(s.titleKey)}</h2>
              <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                {t(s.bodyKey)}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Dots */}
          <div className="flex items-center justify-center gap-1.5 mt-5">
            {SLIDES.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setI(idx)}
                aria-label={`Slide ${idx + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  idx === i ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/40"
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="mt-5 flex items-center gap-2">
            {i > 0 ? (
              <button
                onClick={() => setI(i - 1)}
                className="flex-1 py-3 rounded-2xl bg-muted text-card-foreground font-medium text-sm flex items-center justify-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> {t("tutorial.back")}
              </button>
            ) : (
              <button
                onClick={close}
                className="flex-1 py-3 rounded-2xl bg-muted text-muted-foreground font-medium text-sm"
              >
                {t("tutorial.skip")}
              </button>
            )}
            <button
              onClick={() => (last ? close() : setI(i + 1))}
              className="flex-[1.4] py-3 rounded-2xl bg-gradient-to-r from-primary to-accent text-primary-foreground font-semibold text-sm shadow-lg flex items-center justify-center gap-1"
            >
              {last ? t("tutorial.start") : t("tutorial.next")}
              {!last && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
