import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import logoAsset from "@/assets/logo.png.asset.json";
import { isAppReady, onAppReady } from "@/lib/app-ready";

interface SplashScreenProps {
  minimumDisplayMs?: number;
  children: React.ReactNode;
}

export function SplashScreen({ minimumDisplayMs = 2000, children }: SplashScreenProps) {
  const [minElapsed, setMinElapsed] = useState(false);
  const [appReady, setAppReady] = useState(() => isAppReady());
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinElapsed(true), minimumDisplayMs);
    return () => clearTimeout(timer);
  }, [minimumDisplayMs]);

  useEffect(() => {
    const off = onAppReady(() => setAppReady(true));
    // Failsafe: never keep the splash forever if something goes wrong.
    const failsafe = setTimeout(() => setAppReady(true), 12000);
    return () => {
      off();
      clearTimeout(failsafe);
    };
  }, []);

  useEffect(() => {
    if (minElapsed && appReady) {
      const raf = requestAnimationFrame(() => setIsReady(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [minElapsed, appReady]);

  return (
    <>
      <AnimatePresence>
        {!isReady && (
          <motion.div
            key="splash"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
            aria-label="Loading screen"
            aria-busy="true"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="relative"
            >
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <img
                  src={logoAsset.url}
                  alt="TICK GRAM AI Logo"
                  className="h-32 w-32 rounded-[2rem] object-contain shadow-2xl shadow-primary/20"
                />
              </motion.div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="mt-8 flex flex-col items-center gap-3"
            >
              <span className="text-lg font-semibold tracking-tight text-foreground">
                TICK GRAM AI
              </span>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Children render underneath the splash so the app loads while it's visible */}
      {children}
    </>
  );
}
