import { createServerFn } from "@tanstack/react-start";
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

    if (data.initData && botToken) {
      const { hash, dataCheckString, user } = parseInitData(data.initData);
      if (!verifyTelegramHash(dataCheckString, hash, botToken)) {
        throw new Error("Invalid Telegram initData signature");
      }
      tgUser = user;
    } else if (data.demoId) {
      // Demo mode (preview / no bot token yet)
      tgUser = { id: data.demoId, first_name: "Miner", username: `demo_${data.demoId}` };
    } else {
      throw new Error("Missing Telegram initData");
    }

    if (!tgUser?.id) throw new Error("Missing Telegram user");

    const email = `tg_${tgUser.id}@ultragram.local`;
    // Deterministic strong password (server-only)
    const passSecret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const password = createHmac("sha256", passSecret).update(`tg:${tgUser.id}`).digest("hex");

    // Ensure user exists
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    void existing;
    // Try create; ignore duplicate
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
    let userId = created?.user?.id;
    if (createErr && !userId) {
      // fetch existing by email
      const { data: byEmail } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = byEmail.users.find((u) => u.email === email);
      userId = found?.id;
      if (!userId) throw new Error(createErr.message);
    }
    if (!userId) throw new Error("Failed to resolve user id");

    // Upsert profile — only set fields that are actually provided so we
    // never wipe existing data with nulls on re-auth.
    const profilePatch: Record<string, unknown> = {
      user_id: userId,
      telegram_id: tgUser.id,
    };
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
