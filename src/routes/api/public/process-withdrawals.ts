import { createFileRoute } from "@tanstack/react-router";

// Process pending withdrawals: sign a TON transfer from the hot wallet
// (same as the receiving wallet) and mark the row as paid.
//
// Uses @ton/ton + @ton/crypto — Cloudflare Workers-compatible with
// nodejs_compat (pure JS + tweetnacl).
async function processOne(row: any, supabaseAdmin: any) {
  const { mnemonicToPrivateKey } = await import("@ton/crypto");
  const { TonClient, WalletContractV4, internal, toNano, Address } = await import("@ton/ton");
  const { beginCell, external, storeMessage } = await import("@ton/core");
  const { sendTelegramMessage, WITHDRAWALS_CHAT, escapeHtml } = await import(
    "@/lib/telegram-notify.server"
  );

  // 1) Claim new rows atomically. Existing processing rows are safe retries:
  // wallet seqno prevents two equivalent transfers from both being accepted.
  if (row.status === "pending") {
    const claim = await supabaseAdmin
      .from("withdrawals")
      .update({ status: "processing", processed_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1 })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claim.data) return { id: row.id, skipped: true };
  } else if (row.status !== "processing") {
    return { id: row.id, skipped: true };
  }

  const fail = async (msg: string) => {
    // Only the worker that successfully transitions processing -> failed may
    // refund. This makes retries/concurrent cron invocations refund-safe.
    const { data: failedRow } = await supabaseAdmin
      .from("withdrawals")
      .update({ status: "failed", error_message: msg.slice(0, 500) })
      .eq("id", row.id)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();
    if (!failedRow) return;
    await supabaseAdmin.rpc("atomic_add_balance", { _user_id: row.user_id, _amount: Number(row.amount) });
    // Let the user know their balance was returned.
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("first_name, telegram_id")
        .eq("user_id", row.user_id)
        .maybeSingle();
      if (prof?.telegram_id) {
        const name = prof.first_name || "friend";
        await sendTelegramMessage(
          Number(prof.telegram_id),
          `⚠️ <b>Withdrawal could not be processed</b>\n\n` +
            `Hi ${escapeHtml(name)}, your withdrawal of <b>${Number(row.amount).toFixed(4)} GRAM</b> could not be sent right now.\n\n` +
            `💰 The full amount has been returned to your balance. You can try again later.`,
        );
      }
    } catch (e) {
      console.error("refund notify failed", e);
    }
  };

  // 2) Validate destination address
  let dest: any;
  try { dest = Address.parse(row.address); } catch { await fail(`Invalid address: ${row.address}`); return { id: row.id, error: "invalid_address" }; }

  // 3) Load hot wallet
  const raw = process.env.TON_HOT_WALLET_MNEMONIC;
  if (!raw) { await fail("Missing hot wallet mnemonic"); return { id: row.id, error: "no_mnemonic" }; }

  let keyPair: any, wallet: any, client: any, seqno: number, value: bigint;
  try {
    const words = raw.trim().split(/\s+/);
    keyPair = await mnemonicToPrivateKey(words);
    wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });

    const endpoint = "https://toncenter.com/api/v2/jsonRPC";
    const apiKey = process.env.TONCENTER_API_KEY;
    client = new TonClient({ endpoint, apiKey });
    const contract = client.open(wallet);

    seqno = await contract.getSeqno();
    const netAmount = Number(row.net_amount);
    if (!Number.isFinite(netAmount) || netAmount <= 0) {
      await fail("Invalid net withdrawal amount");
      return { id: row.id, error: "invalid_net_amount" };
    }
    value = toNano(netAmount.toFixed(9));

    // A previous run may have broadcast successfully but timed out before it
    // could observe confirmation. A higher wallet seqno proves it landed.
    const awaitingSeqno = String(row.error_message ?? "").match(/wallet_seqno=(\d+)/)?.[1];
    if (row.status === "processing" && awaitingSeqno && seqno > Number(awaitingSeqno)) {
      const { data: reconciled } = await supabaseAdmin.from("withdrawals").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        error_message: null,
      }).eq("id", row.id).eq("status", "processing").select("id").maybeSingle();
      return { id: row.id, ok: !!reconciled, reconciled: true, tx_hash: row.tx_hash };
    }

    // Insufficient hot-wallet funds -> refund instead of leaving the row stuck.
    const balance: bigint = await client.getBalance(wallet.address);
    // keep a small reserve for network fees
    const reserve = toNano("0.05");
    if (balance < value + reserve) {
      await fail(`insufficient hot wallet funds: have ${balance}, need ${value + reserve}`);
      return { id: row.id, error: "insufficient_funds" };
    }
  } catch (e: any) {
    await fail(`prepare: ${e?.message ?? String(e)}`);
    return { id: row.id, error: "prepare_failed" };
  }


  let txHashB64 = "";
  let txHashHex = "";
  try {
    const transfer = wallet.createTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [
        internal({
          to: dest,
          value,
          body: "TickGram withdraw",
          bounce: false,
        }),
      ],
    });
    const neededInit = seqno === 0 ? wallet.init : undefined;
    const extCell = beginCell()
      .store(
        storeMessage(
          external({
            to: wallet.address,
            init: neededInit,
            body: transfer,
          }),
        ),
      )
      .endCell();
    const hashBuf = extCell.hash();
    txHashB64 = hashBuf.toString("base64");
    txHashHex = hashBuf.toString("hex");
    // Persist the external-message identity before broadcasting. If the HTTP
    // call has an ambiguous network failure, a later audit can reconcile it
    // without ever treating the withdrawal as unsent and refunding it twice.
    const { error: persistErr } = await supabaseAdmin.from("withdrawals").update({
      tx_hash: txHashHex,
      error_message: null,
    }).eq("id", row.id).eq("status", "processing");
    if (persistErr) {
      await fail(`persist transfer identity: ${persistErr.message}`);
      return { id: row.id, error: "persist_failed" };
    }
    await client.sendFile(extCell.toBoc());
  } catch (e: any) {
    // Once a signed external message may have reached the provider, an error
    // is ambiguous: refunding here could pay the user and also send the TON.
    // Keep it processing for reconciliation/retry instead.
    await supabaseAdmin.from("withdrawals").update({
      error_message: `wallet_seqno=${seqno}; broadcast pending confirmation: ${e?.message ?? String(e)}`.slice(0, 500),
    }).eq("id", row.id).eq("status", "processing");
    return { id: row.id, awaiting_confirmation: true };
  }

  // A successful JSON-RPC submission only means the provider accepted the
  // message. Confirm the wallet seqno changed before declaring the withdrawal
  // paid. If confirmation is delayed, leave it processing for the next run.
  let confirmed = false;
  const contract = client.open(wallet);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      if ((await contract.getSeqno()) > seqno) {
        confirmed = true;
        break;
      }
    } catch {
      // Transient provider read errors are retried and never trigger a refund.
    }
  }
  if (!confirmed) {
    await supabaseAdmin.from("withdrawals").update({
      error_message: `wallet_seqno=${seqno}; broadcast accepted; waiting for on-chain confirmation`,
    }).eq("id", row.id).eq("status", "processing");
    return { id: row.id, awaiting_confirmation: true, tx_hash: txHashHex };
  }

  const { data: paidRow, error: paidErr } = await supabaseAdmin.from("withdrawals").update({
    status: "paid",
    paid_at: new Date().toISOString(),
    tx_hash: txHashHex || txHashB64 || `seqno:${seqno}`,
    error_message: null,
  }).eq("id", row.id).eq("status", "processing").select("id").maybeSingle();
  if (paidErr || !paidRow) {
    return { id: row.id, awaiting_reconciliation: true, tx_hash: txHashHex };
  }

  // Notify withdrawals group + DM the user
  try {
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("username, first_name, telegram_id")
      .eq("user_id", row.user_id)
      .maybeSingle();
    const handle = prof?.username ? `@${prof.username}` : (prof?.first_name || "user");
    const amount = Number(row.net_amount ?? row.amount).toFixed(2);
    const explorerUrl = txHashHex
      ? `https://tonscan.org/tx/${txHashHex}`
      : `https://tonscan.org/address/${dest.toString({ urlSafe: true, bounceable: false })}`;
    const groupText =
      `✅ <b>Withdraw Approved!</b>\n\n` +
      `👤 User: ${escapeHtml(handle)}\n\n` +
      `💰 Amount: ${amount} GRAM\n\n` +
      `🔗 <a href="${explorerUrl}">View on TONScan →</a>`;
    await sendTelegramMessage(WITHDRAWALS_CHAT, groupText);

    if (prof?.telegram_id) {
      const name = prof.first_name || "friend";
      const userText =
        `✅ <b>Withdrawal completed!</b>\n\n` +
        `Hi ${escapeHtml(name)}, your withdrawal of <b>${amount} GRAM</b> has been sent to your wallet.\n\n` +
        `🔗 <a href="${explorerUrl}">View transaction on TONScan →</a>`;
      await sendTelegramMessage(Number(prof.telegram_id), userText);
    }
  } catch (e) {
    console.error("telegram notify failed", e);
  }

  return { id: row.id, ok: true, seqno, tx_hash: txHashB64 };
}


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

export const Route = createFileRoute("/api/public/process-withdrawals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: rows, error } = await supabaseAdmin
          .from("withdrawals")
          .select("*")
          .in("status", ["pending", "processing"])
          .order("status", { ascending: false })
          .order("created_at", { ascending: true })
          // One transfer per run guarantees each withdrawal gets a distinct
          // wallet seqno and avoids collisions while the prior tx confirms.
          .limit(1);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results: any[] = [];
        for (const row of rows ?? []) {
          try {
            results.push(await processOne(row, supabaseAdmin));
          } catch (e: any) {
            // Never refund an unexpected processing-state crash automatically:
            // the signed message may already have reached the chain. Preserve
            // it for reconciliation instead of risking a double payment.
            const { data: cur } = await supabaseAdmin
              .from("withdrawals").select("status,tx_hash").eq("id", row.id).maybeSingle();
            if (cur?.status === "processing") {
              await supabaseAdmin.from("withdrawals")
                .update({ error_message: `worker retry required: ${String(e?.message ?? e)}`.slice(0, 500) })
                .eq("id", row.id).eq("status", "processing");
            }
            results.push({ id: row.id, error: e?.message ?? String(e), awaiting_reconciliation: cur?.status === "processing" });
          }

        }
        return Response.json({ processed: results.length, results });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to process pending withdrawals" }),
    },
  },
});
