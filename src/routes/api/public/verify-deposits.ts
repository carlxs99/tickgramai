import { createFileRoute } from "@tanstack/react-router";

const RECEIVING_WALLET = "UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn";
const DAILY_ROI = 0.033;

export const Route = createFileRoute("/api/public/verify-deposits")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { Address } = await import("@ton/core");

        // Canonical raw address of our receiving wallet ("0:abcd…")
        const oursRaw = Address.parse(RECEIVING_WALLET).toRawString().toLowerCase();

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

          const { data: existing } = await supabaseAdmin
            .from("processed_tx").select("tx_hash").eq("tx_hash", txHash).maybeSingle();
          if (existing) continue;

          const actions: any[] = Array.isArray(ev?.actions) ? ev.actions : [];
          for (const a of actions) {
            if (a?.type !== "TonTransfer" || a?.status !== "ok") continue;
            const t = a.TonTransfer ?? a.ton_transfer ?? {};

            // Recipient can be an object {address} or a raw string.
            const recipientRaw: string | undefined =
              (typeof t?.recipient === "string" ? t.recipient : t?.recipient?.address) ??
              (typeof t?.to === "string" ? t.to : t?.to?.address);
            if (!recipientRaw) continue;

            // Normalise both sides to canonical raw form.
            let recvRaw: string;
            try { recvRaw = Address.parse(recipientRaw).toRawString().toLowerCase(); }
            catch { continue; }
            if (recvRaw !== oursRaw) continue;

            const comment: string = (t?.comment ?? "").toString().trim().toUpperCase();
            const amountNano: number = Number(t?.amount ?? 0);
            if (amountNano <= 0 || !comment) {
              results.push({ txHash, skipped: "no_comment_or_amount" });
              continue;
            }

            const { data: profile } = await supabaseAdmin
              .from("profiles").select("user_id, mining_rate, memo_tag")
              .eq("memo_tag", comment).maybeSingle();
            if (!profile) {
              results.push({ txHash, memo: comment, skipped: "no_user" });
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

