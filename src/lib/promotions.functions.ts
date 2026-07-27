import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Current site-wide deposit bonus promotion (readable by any signed-in user).
export const getActivePromotion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const nowIso = new Date().toISOString();
    const { data, error } = await context.supabase
      .from("deposit_promotions")
      .select("id, percent, starts_at, ends_at")
      .lte("starts_at", nowIso)
      .gt("ends_at", nowIso)
      .order("percent", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { promotion: null as null | { id: string; percent: number; starts_at: string; ends_at: string } };
    return {
      promotion: {
        id: String((data as any).id),
        percent: Number((data as any).percent),
        starts_at: String((data as any).starts_at),
        ends_at: String((data as any).ends_at),
      },
    };
  });
