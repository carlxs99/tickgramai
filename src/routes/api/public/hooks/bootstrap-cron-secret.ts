import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// One-shot bootstrap: copies the CRON_SECRET env value into Postgres Vault
// so pg_cron jobs can read it and send Authorization: Bearer <secret>
// without embedding the plaintext in cron.job SQL.
//
// Safe to expose: does not echo the secret. Idempotent (upserts vault entry).
async function bootstrap(): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 500 });

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { error } = await supabase.rpc("_set_cron_secret", { _value: secret });
  if (error) return new Response(`vault write failed: ${error.message}`, { status: 500 });

  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/public/hooks/bootstrap-cron-secret")({
  server: {
    handlers: {
      GET: async () => bootstrap(),
      POST: async () => bootstrap(),
    },
  },
});
