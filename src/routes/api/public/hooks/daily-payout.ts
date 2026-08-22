import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const HOT_WALLET = "UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn";
const BATCH = 300;
const MAX_ROUNDS = 20;

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided =
    header.replace(/^Bearer\s+/i, "").trim() || request.headers.get("x-cron-secret") || "";
  return provided.length > 0 && safeEqual(provided, expected);
}

/** On-chain balance of the hot wallet, in TON. 0 when unavailable. */
async function fetchTreasuryTon(): Promise<number> {
  try {
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(HOT_WALLET)}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return 0;
    const json = (await res.json()) as { balance?: string | number };
    return Number(json?.balance ?? 0) / 1e9;
  } catch {
    return 0;
  }
}

export const Route = createFileRoute("/api/public/hooks/daily-payout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

        const supabase = supa();

        // Feature flag: while ECONOMY_V2 is off, the payout does nothing.
        const { data: flag } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "economy_v2")
          .maybeSingle();
        if (!(flag as { value?: { enabled?: boolean } } | null)?.value?.enabled) {
          return Response.json({ ok: true, skipped: "economy_v2_disabled" });
        }

        const body = (await request.json().catch(() => ({}))) as { day?: string };
        const day =
          body?.day ??
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // yesterday (UTC)

        const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
        const [gramPrice, treasuryTon] = await Promise.all([
          fetchTonPriceUsdt().catch(() => 0),
          fetchTreasuryTon(),
        ]);

        let processed = 0;
        let remaining = 0;
        let status = "running";
        let poolUsd = 0;
        let solvency: number | null = null;

        for (let i = 0; i < MAX_ROUNDS; i++) {
          const { data, error } = await supabase.rpc("run_daily_payout" as never, {
            _day: day,
            _gram_price: gramPrice > 0 ? gramPrice : 1,
            _treasury_ton: treasuryTon,
            _batch: BATCH,
          } as never);
          if (error) {
            return Response.json({ ok: false, day, error: error.message }, { status: 500 });
          }
          const row = (Array.isArray(data) ? data[0] : data) as
            | { status: string; processed: number; remaining: number; pool_usd: number; solvency: number }
            | undefined;
          if (!row) break;
          processed += Number(row.processed ?? 0);
          remaining = Number(row.remaining ?? 0);
          status = row.status;
          poolUsd = Number(row.pool_usd ?? 0);
          solvency = row.solvency == null ? null : Number(row.solvency);
          if (status === "done" || remaining === 0) break;
        }

        return Response.json({
          ok: true,
          day,
          status,
          processed,
          remaining,
          poolUsd,
          treasuryTon,
          gramPrice,
          solvency,
        });
      },
      GET: async () => Response.json({ ok: true, hint: "POST with CRON_SECRET to run payout" }),
    },
  },
});
