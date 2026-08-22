import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createHmac } from "crypto";

const AuthInput = z.object({
  initData: z.string().optional(),
  demoId: z.number().int().optional(),
});

function parseInitData(initData: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  params.delete("hash");
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const userJson = params.get("user");
  const user = userJson ? JSON.parse(userJson) : null;
  const startParam = params.get("start_param") ?? null;
  return { hash, dataCheckString, user, startParam };
}

function verifyTelegramHash(dataCheckString: string, hash: string, botToken: string) {
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return computed === hash;
}

export const authWithTelegram = createServerFn({ method: "POST" })
  .inputValidator((d: z.infer<typeof AuthInput>) => AuthInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createClient } = await import("@supabase/supabase-js");

    let tgUser: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
      photo_url?: string;
      language_code?: string;
      is_premium?: boolean;
    } | null = null;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    let startParam: string | null = null;
    if (data.initData && botToken) {
      const parsed = parseInitData(data.initData);
      if (!verifyTelegramHash(parsed.dataCheckString, parsed.hash, botToken)) {
        throw new Error("Invalid Telegram initData signature");
      }
      tgUser = parsed.user;
      startParam = parsed.startParam;
    } else if (data.demoId && process.env.ENABLE_DEMO_AUTH === "1") {
      // Demo mode: ONLY enabled via explicit env flag (non-production).
      // Without this gate, anyone could sign in as any telegram_id
      // (impersonation of arbitrary users). Do NOT set ENABLE_DEMO_AUTH=1
      // in the production environment.
      tgUser = { id: data.demoId, first_name: "Miner", username: `demo_${data.demoId}` };
    } else {
      throw new Error("Missing Telegram initData");
    }

    if (!tgUser?.id) throw new Error("Missing Telegram user");

    const email = `tg_${tgUser.id}@ultragram.local`;
    // Deterministic strong password (server-only)
    const passSecret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const password = createHmac("sha256", passSecret).update(`tg:${tgUser.id}`).digest("hex");

    // Resolve user id: prefer an existing profile keyed by telegram_id
    // (fast, indexed, and immune to auth listUsers pagination limits).
    let userId: string | undefined;
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("telegram_id", tgUser.id)
      .maybeSingle();
    if (existingProfile?.user_id) {
      userId = existingProfile.user_id as string;
    } else {
      // Create the auth user. If it already exists (email collision from a
      // previous run without a profile), fall back to paginating listUsers.
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          telegram_id: tgUser.id,
          username: tgUser.username,
          first_name: tgUser.first_name,
          last_name: tgUser.last_name,
          avatar_url: tgUser.photo_url,
        },
      });
      userId = created?.user?.id;
      if (!userId && createErr) {
        // Paginate through auth users to find the matching email.
        for (let page = 1; page <= 20 && !userId; page++) {
          const { data: pageData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: 1000,
          });
          if (listErr) break;
          const found = pageData.users.find((u) => u.email === email);
          if (found) userId = found.id;
          if (!pageData.users.length || pageData.users.length < 1000) break;
        }
        if (!userId) throw new Error(createErr.message);
      }
    }
    if (!userId) throw new Error("Failed to resolve user id");

    // Always make sure the auth password matches our deterministic one so
    // signInWithPassword below succeeds even for legacy users whose password
    // hash was created with a different secret.
    await supabaseAdmin.auth.admin.updateUserById(userId, { password });


    // Upsert profile — only set fields that are actually provided so we
    // never wipe existing data with nulls on re-auth.
    const profilePatch: Record<string, unknown> = {
      user_id: userId,
      telegram_id: tgUser.id,
    };
    // Client IP (Cloudflare / proxy aware) for multi-account detection.
    const clientIp = (() => {
      try {
        const req = getRequest();
        const raw =
          req.headers.get("cf-connecting-ip") ??
          req.headers.get("x-real-ip") ??
          (req.headers.get("x-forwarded-for") ?? "").split(",")[0];
        const ip = (raw ?? "").trim();
        return ip && ip.length <= 45 ? ip : null;
      } catch {
        return null;
      }
    })();
    if (clientIp) {
      profilePatch.last_ip = clientIp;
      if (!existingProfile?.user_id) profilePatch.signup_ip = clientIp;
    }
    profilePatch.last_seen_at = new Date().toISOString();
    if (tgUser.username) profilePatch.username = tgUser.username;
    if (tgUser.first_name) profilePatch.first_name = tgUser.first_name;
    if (tgUser.last_name) profilePatch.last_name = tgUser.last_name;
    if (tgUser.photo_url) profilePatch.avatar_url = tgUser.photo_url;
    if (tgUser.language_code) profilePatch.language_code = tgUser.language_code;
    if (typeof tgUser.is_premium === "boolean") profilePatch.is_premium = tgUser.is_premium;

    const { error: upsertErr } = await supabaseAdmin
      .from("profiles")
      .upsert(profilePatch as never, { onConflict: "user_id" });
    if (upsertErr) {
      console.error("[telegram-auth] profile upsert failed:", upsertErr);
      throw new Error(`Profile upsert failed: ${upsertErr.message}`);
    }

    // Referral linking: if a start_param (referral code) was provided and this
    // profile has no referrer yet, attach it. Never self-refer.
    if (startParam) {
      const code = startParam.trim();
      const { data: myProfile } = await supabaseAdmin
        .from("profiles")
        .select("id, referred_by, referral_code")
        .eq("user_id", userId)
        .maybeSingle();
      if (
        myProfile &&
        !myProfile.referred_by &&
        (myProfile.referral_code ?? "").toLowerCase() !== code.toLowerCase()
      ) {
        // Case-insensitive match: referral_codes are stored lowercase but
        // Telegram start_param casing is not guaranteed.
        const { data: referrer } = await supabaseAdmin
          .from("profiles")
          .select("id, user_id, referral_code")
          .ilike("referral_code", code)
          .maybeSingle();
        if (referrer && referrer.user_id !== userId) {
          await supabaseAdmin
            .from("profiles")
            .update({ referred_by: referrer.id })
            .eq("user_id", userId);
          const { data: refRow } = await supabaseAdmin
            .from("referrals")
            .insert({ referrer_id: referrer.user_id, referred_id: userId })
            .select()
            .maybeSingle();

          // Signup reward: $0.10 of mining capital for the referrer.
          // It is NOT paid as balance — it is added to their daily mining
          // income at the standard 3.3% daily ROI ($0.0033/day).
          if (refRow) {
            try {
              const { fetchTonPriceUsdt } = await import("@/lib/prices.server");
              const price = await fetchTonPriceUsdt();
              const SIGNUP_CAPITAL_USD = 0.1;
              const DAILY_ROI = 0.033;
              const addUsdPerDay = SIGNUP_CAPITAL_USD * DAILY_ROI;
              const addGramPerDay = price > 0 ? addUsdPerDay / price : 0;
              await supabaseAdmin.rpc("atomic_add_mining_rate" as never, {
                _user_id: referrer.user_id,
                _add_rate_usd: addUsdPerDay,
                _add_rate_gram: addGramPerDay,
                _add_deposit_ton: 0,
              } as never);

              // Economy v2: same reward expressed as mining power (100 pts / USD).
              await supabaseAdmin.rpc("grant_hashrate" as never, {
                _user_id: referrer.user_id,
                _points: SIGNUP_CAPITAL_USD * 100,
                _source: "referral_signup",
                _source_ref_id: null,
                _days: 180,
              } as never);


              const { data: refProfile } = await supabaseAdmin
                .from("profiles")
                .select("telegram_id, first_name")
                .eq("user_id", referrer.user_id)
                .maybeSingle();
              if (refProfile?.telegram_id) {
                const { sendTelegramMessage } = await import("@/lib/telegram-notify.server");
                const { formatReward } = await import("@/lib/format");
                await sendTelegramMessage(
                  Number(refProfile.telegram_id),
                  `👥 <b>New referral joined!</b>\n\n` +
                    `Hi ${refProfile.first_name || "friend"}, a new friend just joined with your link.\n\n` +
                    `🎁 Signup reward: <b>$0.10 mining capital</b>\n` +
                    `⚡ Added to your daily income: <b>+$${addUsdPerDay.toFixed(4)}/day</b>` +
                    (addGramPerDay > 0 ? `\n🪙 <b>+${formatReward(addGramPerDay)} GRAM/day</b>` : "") +
                    `\n\nKeep inviting friends to grow your mining rate!`,
                );
              }
            } catch (e) {
              console.error("[telegram-auth] referral signup reward failed", e);
            }
          }
        }

      }
    }

    // Sign in with password using publishable client (returns tokens)
    const pub = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: sess, error: sErr } = await pub.auth.signInWithPassword({ email, password });
    if (sErr || !sess.session) throw new Error(sErr?.message ?? "Sign-in failed");

    return {
      accessToken: sess.session.access_token,
      refreshToken: sess.session.refresh_token,
      userId,
    };
  });
