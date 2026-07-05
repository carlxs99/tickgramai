import { createFileRoute } from "@tanstack/react-router";


const RECEIVING_WALLET = "UQBqvqYaZBfeVvW9eFUUf4rrVF4Z71wJnxyDwyKdQLTKnIJn";
const DAILY_ROI = 0.033;

// Timing-safe comparison for shared-secret auth.
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
  const provided = header.replace(/^Bearer\s+/i, "").trim() ||
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret") || "";
  return provided.length > 0 && safeEqual(provided, expected);
}

export const Route = createFileRoute("/api/public/verify-deposits")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { Address } = await import("@ton/core");
        const { sendTelegramMessage } = await import("@/lib/telegram-notify.server");
        const { fetchTonPriceUsdt } = await import("@/lib/prices.functions");

        // TON price at the moment of confirmation — used to lock in the USD-denominated ROI.
        const tonPriceAtDeposit = await fetchTonPriceUsdt();

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

            const amountTon = amountNano / 1e9;

            // Partner-task payment: memo starts with "PT". Activate the task
            // if the payment covers cost_ton; otherwise skip.
            if (comment.startsWith("PT")) {
              const { data: ptask } = await supabaseAdmin
                .from("partner_tasks")
                .select("id, cost_ton, status")
                .eq("memo_tag", comment)
                .maybeSingle();
              if (!ptask) {
                results.push({ txHash, memo: comment, skipped: "no_partner_task" });
                continue;
              }
              if (ptask.status !== "pending_payment") {
                results.push({ txHash, memo: comment, skipped: "already_activated" });
                continue;
              }
              if (amountTon + 1e-6 < Number(ptask.cost_ton)) {
                results.push({ txHash, memo: comment, skipped: "insufficient_payment" });
                continue;
              }
              // Record the tx as processed (prevents replays) and activate the task.
              const { error: pErr } = await supabaseAdmin.from("processed_tx").insert({
                tx_hash: txHash,
                user_id: null,
                memo: comment,
                amount_ton: amountTon,
                gram_credited: 0,
              });
              if (pErr) {
                results.push({ txHash, error: pErr.message });
                continue;
              }
              await supabaseAdmin
                .from("partner_tasks")
                .update({ status: "active", tx_hash: txHash })
                .eq("id", ptask.id);
              credited += 1;
              results.push({ txHash, memo: comment, partnerTask: ptask.id, activated: true });
              continue;
            }

            const { data: profile } = await supabaseAdmin
              .from("profiles").select("user_id, mining_rate, mining_rate_usd, memo_tag, referred_by, telegram_id, first_name")
              .eq("memo_tag", comment).maybeSingle();
            if (!profile) {
              results.push({ txHash, memo: comment, skipped: "no_user" });
              continue;
            }


            // Consume active gift-box deposit bonus (0 if none). The bonus
            // acts as if the user deposited an extra percentage on top of the
            // real amount — e.g. a 10% bonus on 1 TON is credited as 1.1 TON.
            const { data: bonusPct } = await supabaseAdmin
              .rpc("consume_active_deposit_bonus" as never, { _user_id: profile.user_id } as never);
            const bonusPercent = Number(bonusPct ?? 0);
            const bonusMultiplier = 1 + bonusPercent / 100;
            const effectiveAmountTon = amountTon * bonusMultiplier;
            const bonusAmountTon = effectiveAmountTon - amountTon;

            // Deterministic ROI: 3.3% daily denominated in USDT.
            const priceForCredit = tonPriceAtDeposit > 0 ? tonPriceAtDeposit : 1;
            const usdValue = effectiveAmountTon * priceForCredit;
            const usdPerDay = usdValue * DAILY_ROI;
            const gramPerDay = effectiveAmountTon * DAILY_ROI;
            const newRateUsd = Number((profile as any).mining_rate_usd ?? 0) + usdPerDay;
            void newRateUsd;

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
              amount_ton: effectiveAmountTon,
              gram_per_day: gramPerDay,
              tx_hash: txHash,
              status: "confirmed",
            });

            // Atomic increment — prevents lost-updates with completeTask /
            // reinvestBalance running concurrently for the same user.
            await supabaseAdmin.rpc("atomic_add_mining_rate" as never, {
              _user_id: profile.user_id,
              _add_rate_usd: usdPerDay,
              _add_rate_gram: gramPerDay,
              _add_deposit_ton: effectiveAmountTon,
            } as never);
            const newRateGram = Number((profile as any).mining_rate ?? 0) + gramPerDay;
            void newRateGram;












            // Referral bonus: 10% of deposit (in GRAM) credited from the
            // system to the referrer. The referred user is untouched.
            let referrerNotify: { telegram_id: number | null; first_name: string | null; bonus: number } | null = null;
            if (profile.referred_by) {
              const { data: refProfile } = await supabaseAdmin
                .from("profiles")
                .select("user_id, telegram_id, first_name")
                .eq("id", profile.referred_by)
                .maybeSingle();
              if (refProfile) {
                const bonus = amountTon * 0.10;
                // Atomic add: avoids lost-update when the referrer is also
                // collecting income or claiming rewards concurrently.
                await supabaseAdmin
                  .rpc("atomic_add_balance" as never, { _user_id: refProfile.user_id, _amount: bonus } as never);
                const { data: refRow } = await supabaseAdmin
                  .from("referrals")
                  .select("id, bonus_earned")
                  .eq("referrer_id", refProfile.user_id)
                  .eq("referred_id", profile.user_id)
                  .maybeSingle();
                if (refRow) {
                  await supabaseAdmin
                    .from("referrals")
                    .update({ bonus_earned: Number(refRow.bonus_earned ?? 0) + bonus })
                    .eq("id", refRow.id);
                } else {
                  await supabaseAdmin.from("referrals").insert({
                    referrer_id: refProfile.user_id,
                    referred_id: profile.user_id,
                    bonus_earned: bonus,
                  });
                }
                referrerNotify = {
                  telegram_id: refProfile.telegram_id as number | null,
                  first_name: (refProfile.first_name as string | null) ?? null,
                  bonus,
                };
              }
            }

            // Telegram DMs (best-effort)
            try {
              if (profile.telegram_id) {
                const name = profile.first_name || "friend";
                const bonusLine = bonusPercent > 0
                  ? `🎁 Deposit bonus: <b>+${bonusPercent.toFixed(2)}%</b> (+${bonusAmountTon.toFixed(4)} TON)\n` +
                    `💎 Effective deposit: <b>${effectiveAmountTon.toFixed(4)} TON</b>\n`
                  : "";
                await sendTelegramMessage(
                  Number(profile.telegram_id),
                  `✅ <b>Deposit confirmed!</b>\n\n` +
                    `Hi ${name}, we received your deposit of <b>${amountTon.toFixed(4)} TON</b>.\n\n` +
                    bonusLine +
                    `⚡ Mining rate added: <b>+$${usdPerDay.toFixed(4)} USDT/day</b>\n` +
                    `📈 Daily ROI: 3.3%\n\n` +
                    `Open TICK GRAM AI to check your balance.`,
                );
              }
              if (referrerNotify?.telegram_id) {
                const refName = referrerNotify.first_name || "friend";
                await sendTelegramMessage(
                  Number(referrerNotify.telegram_id),
                  `🎉 <b>Referral commission earned!</b>\n\n` +
                    `Hi ${refName}, one of your referrals just made a deposit of <b>${amountTon.toFixed(4)} TON</b>.\n\n` +
                    `💰 Your 10% commission: <b>+${referrerNotify.bonus.toFixed(4)} GRAM</b>\n\n` +
                    `Keep inviting friends to earn more!`,
                );
              }
            } catch (e) {
              console.error("telegram deposit notify failed", e);
            }

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

