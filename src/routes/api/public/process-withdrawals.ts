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

  // 1) Claim the row atomically: only proceed if we can flip status pending -> processing.
  const claim = await supabaseAdmin
    .from("withdrawals")
    .update({ status: "processing", processed_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1 })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claim.data) return { id: row.id, skipped: true };

  const fail = async (msg: string) => {
    await supabaseAdmin.from("withdrawals").update({ status: "failed", error_message: msg.slice(0, 500) }).eq("id", row.id);
    // Atomic refund: prevents lost-update against concurrent balance mutations.
    await supabaseAdmin.rpc("atomic_add_balance", { _user_id: row.user_id, _amount: Number(row.amount) });
  };

  // 2) Validate destination address
  let dest: any;
  try { dest = Address.parse(row.address); } catch { await fail(`Invalid address: ${row.address}`); return { id: row.id, error: "invalid_address" }; }

  // 3) Load hot wallet
  const raw = process.env.TON_HOT_WALLET_MNEMONIC;
  if (!raw) { await fail("Missing hot wallet mnemonic"); return { id: row.id, error: "no_mnemonic" }; }
  const words = raw.trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });

  const endpoint = "https://toncenter.com/api/v2/jsonRPC";
  const apiKey = process.env.TONCENTER_API_KEY;
  const client = new TonClient({ endpoint, apiKey });
  const contract = client.open(wallet);

  const seqno = await contract.getSeqno();
  const value = toNano(String(row.net_amount));

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
    await client.sendFile(extCell.toBoc());
  } catch (e: any) {
    await fail(`send: ${e?.message ?? String(e)}`);
    return { id: row.id, error: "send_failed" };
  }

  await supabaseAdmin.from("withdrawals").update({
    status: "paid",
    paid_at: new Date().toISOString(),
    tx_hash: txHashHex || txHashB64 || `seqno:${seqno}`,
  }).eq("id", row.id);

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
        `🔗 <a href="${explorerUrl}">View transaction on GRAM Explorer →</a>`;
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
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret") || "";
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
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(10);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results: any[] = [];
        for (const row of rows ?? []) {
          try {
            results.push(await processOne(row, supabaseAdmin));
          } catch (e: any) {
            results.push({ id: row.id, error: e?.message ?? String(e) });
          }
        }
        return Response.json({ processed: results.length, results });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to process pending withdrawals" }),
    },
  },
});
