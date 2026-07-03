import { createFileRoute } from "@tanstack/react-router";

const RECEIVING_WALLET = "UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn";
const DAILY_ROI = 0.033;

export const Route = createFileRoute("/api/public/verify-deposits")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Fetch recent events for our receiving wallet from tonapi.io (free tier)
        const url = `https://tonapi.io/v2/accounts/${encodeURIComponent(
          RECEIVING_WALLET
        )}/events?limit=50`;
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) {
          return Response.json({ ok: false, error: `tonapi ${res.status}` }, { status: 502 });
        }
        const json = (await res.json()) as any;
        const events: any[] = Array.isArray(json?.events) ? json.events : [];

        let credited = 0;
        const results: any[] = [];

        for (const ev of events) {
          const txHash: string = ev?.event_id ?? "";
          if (!txHash) continue;

          // Skip if already processed
          const { data: existing } = await supabaseAdmin
            .from("processed_tx").select("tx_hash").eq("tx_hash", txHash).maybeSingle();
          if (existing) continue;

          // Look for a TonTransfer action into our wallet
          const actions: any[] = Array.isArray(ev?.actions) ? ev.actions : [];
          for (const a of actions) {
            if (a?.type !== "TonTransfer" || a?.status !== "ok") continue;
            const t = a.TonTransfer ?? a.ton_transfer ?? {};
            const recipient: string | undefined =
              t?.recipient?.address ?? t?.recipient ?? t?.to;
            const comment: string = (t?.comment ?? "").toString().trim().toUpperCase();
            const amountNano: number = Number(t?.amount ?? 0);
            if (!recipient || amountNano <= 0 || !comment) continue;

            // Match receiver (raw or friendly). Simple normalization: last 40 chars.
            const normRecv = recipient.replace(/[^a-zA-Z0-9]/g, "").slice(-40);
            const normOurs = RECEIVING_WALLET.replace(/[^a-zA-Z0-9]/g, "").slice(-40);
            if (normRecv !== normOurs) continue;

            // Find user by memo
            const { data: profile } = await supabaseAdmin
              .from("profiles").select("user_id, mining_rate, memo_tag")
              .eq("memo_tag", comment).maybeSingle();
            if (!profile) {
              results.push({ txHash, memo: comment, skipped: "no user" });
              continue;
            }

            const amountTon = amountNano / 1e9;
            const gramPerDay = amountTon * DAILY_ROI;
            const newRate = Number(profile.mining_rate ?? 0) + gramPerDay;

            const { error: iErr } = await supabaseAdmin.from("processed_tx").insert({
              tx_hash: txHash,
              user_id: profile.user_id,
              memo: comment,
              amount_ton: amountTon,
              gram_credited: gramPerDay,
            });
            if (iErr) {
              results.push({ txHash, error: iErr.message });
              continue;
            }

            await supabaseAdmin.from("deposits").insert({
              user_id: profile.user_id,
              amount_ton: amountTon,
              gram_per_day: gramPerDay,
              tx_hash: txHash,
              status: "confirmed",
            });

            await supabaseAdmin.from("profiles")
              .update({ mining_rate: newRate })
              .eq("user_id", profile.user_id);

            credited += 1;
            results.push({ txHash, user: profile.user_id, amountTon, gramPerDay });
            break;
          }
        }

        return Response.json({ ok: true, credited, checked: events.length, results });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to verify" }),
    },
  },
});
