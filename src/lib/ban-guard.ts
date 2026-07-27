// Shared guard: blocks banned accounts from performing economic actions.
// Takes the caller's own (RLS-scoped) Supabase client, so it holds no secrets
// and is safe to import at module scope from *.functions.ts files.
export const BANNED_ERROR = "ACCOUNT_BANNED";

export async function assertNotBanned(supabase: any, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("banned, ban_reason")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.banned) {
    throw new Error(`${BANNED_ERROR}: ${data.ban_reason || "Account suspended"}`);
  }
}
