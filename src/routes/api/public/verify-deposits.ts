import { createFileRoute } from '@tanstack/react-router'
import { formatReward } from "@/lib/format";


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
    request.headers.get("x-cron-secret") || "";
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

            // Enforce minimum deposit of 0.1 GRAM (TON) for user deposits.
            if (amountTon + 1e-9 < 0.1) {
              results.push({ txHash, memo: comment, skipped: "below_min_deposit" });
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












            // ============================================================
            // 3-level referral commissions (10% / 5% / 3% of deposit in GRAM).
            // Each ancestor's refback_rate is deducted from their commission
            // and credited back to the depositor's balance.
            // Chain is resolved by get_referral_ancestors() (walks profiles.referred_by).
            // ============================================================
            const LEVEL_RATES = [0.10, 0.05, 0.03] as const;
            type Ancestor = {
              level: number;
              user_id: string;
              telegram_id: number | null;
              first_name: string | null;
              refback_rate: number | null;
            };
            const { data: ancestorsData } = await supabaseAdmin
              .rpc("get_referral_ancestors" as never, { _user_id: profile.user_id } as never);
            const ancestors = (ancestorsData ?? []) as Ancestor[];

            const referrerNotifies: Array<{
              telegram_id: number | null;
              first_name: string | null;
              level: number;
              percent: number;
              commission: number;
              refbackReturned: number;
            }> = [];
            let totalRefbackToDepositor = 0;

            for (const anc of ancestors) {
              const rate = LEVEL_RATES[(anc.level ?? 1) - 1];
              if (!rate) continue;
              // Commission is paid entirely by the SYSTEM to the ancestor
              // at the advertised rate (10/5/3%). No refback to depositor.
              const grossBonus = amountTon * rate;
              const refbackShare = 0;
              const netBonus = grossBonus;

              // Credit the ancestor's balance (atomic).
              if (netBonus > 0) {
                await supabaseAdmin.rpc(
                  "atomic_add_balance" as never,
                  { _user_id: anc.user_id, _amount: netBonus } as never,
                );
              }
              // Accumulate lifetime earnings & refback paid on ancestor's profile
              // (read-modify-write; best-effort stat, not economic state).
              const { data: pRow } = await supabaseAdmin
                .from("profiles")
                .select("referral_earned_total, refback_paid")
                .eq("user_id", anc.user_id)
                .maybeSingle();
              await supabaseAdmin
                .from("profiles")
                .update({
                  referral_earned_total: Number((pRow as any)?.referral_earned_total ?? 0) + netBonus,
                  refback_paid: Number((pRow as any)?.refback_paid ?? 0) + refbackShare,
                } as never)
                .eq("user_id", anc.user_id);


              // Keep L1 per-friend row in sync for the friends list display.
              if (anc.level === 1) {
                const { data: refRow } = await supabaseAdmin
                  .from("referrals")
                  .select("id, bonus_earned")
                  .eq("referrer_id", anc.user_id)
                  .eq("referred_id", profile.user_id)
                  .maybeSingle();
                if (refRow) {
                  await supabaseAdmin
                    .from("referrals")
                    .update({ bonus_earned: Number(refRow.bonus_earned ?? 0) + netBonus })
                    .eq("id", refRow.id);
                } else {
                  await supabaseAdmin.from("referrals").insert({
                    referrer_id: anc.user_id,
                    referred_id: profile.user_id,
                    bonus_earned: netBonus,
                  });
                }
              }

              referrerNotifies.push({
                telegram_id: anc.telegram_id,
                first_name: anc.first_name,
                level: anc.level,
                percent: rate * 100,
                commission: netBonus,
                refbackReturned: refbackShare,
              });
            }

            // Credit refback total back to the depositor.
            if (totalRefbackToDepositor > 0) {
              await supabaseAdmin.rpc(
                "atomic_add_balance" as never,
                { _user_id: profile.user_id, _amount: totalRefbackToDepositor } as never,
              );
            }

            // Telegram DMs (best-effort)
            try {
              if (profile.telegram_id) {
                const name = profile.first_name || "friend";
                const gramPerDayStr = formatReward(gramPerDay);
                const bonusLine = bonusPercent > 0
                  ? `🎁 Deposit bonus: <b>+${bonusPercent.toFixed(2)}%</b> (+${formatReward(bonusAmountTon)} TON)\n` +
                    `💎 Effective deposit: <b>${formatReward(effectiveAmountTon)} TON</b>\n`
                  : "";
                const refbackLine = totalRefbackToDepositor > 0
                  ? `🔁 Refback received: <b>+${formatReward(totalRefbackToDepositor)} GRAM</b>\n`
                  : "";
                await sendTelegramMessage(
                  Number(profile.telegram_id),
                  `✅ <b>Deposit confirmed!</b>\n\n` +
                    `Hi ${name}, we received your deposit of <b>${formatReward(amountTon)} TON</b>.\n\n` +
                    bonusLine +
                    refbackLine +
                    `⚡ Mining rate added: <b>+$${formatReward(usdPerDay)} USDT/day</b>\n` +
                    `🪙 GRAM per day: <b>+${gramPerDayStr} GRAM</b>\n` +
                    `📈 Daily ROI: 3.3%\n\n` +
                    `Open TICK GRAM AI to check your balance.`,
                );
              }

              for (const rn of referrerNotifies) {
                if (!rn.telegram_id) continue;
                const refName = rn.first_name || "friend";
                const levelLabel = rn.level === 1 ? "direct referral" : rn.level === 2 ? "level 2 referral" : "level 3 referral";
                await sendTelegramMessage(
                  Number(rn.telegram_id),
                  `🎉 <b>Referral commission earned!</b>\n\n` +
                    `Hi ${refName}, one of your ${levelLabel}s just made a deposit of <b>${formatReward(amountTon)} GRAM</b>.\n\n` +
                    `💰 Your ${rn.percent}% commission (level ${rn.level}): <b>+${formatReward(rn.commission)} GRAM</b>\n\n` +
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

