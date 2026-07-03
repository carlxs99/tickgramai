import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string; photo_url?: string } };
        ready: () => void;
        expand: () => void;
        HapticFeedback?: { impactOccurred: (s: "light" | "medium" | "heavy") => void };
        colorScheme?: "light" | "dark";
        openTelegramLink?: (url: string) => void;
      };
    };
  }
}

export function getTelegram() {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export async function restoreSession(tokens: { accessToken: string; refreshToken: string }) {
  const { error } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (error) throw error;
}
