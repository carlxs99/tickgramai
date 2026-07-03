import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Forbidden: admin only");
}

export const adminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      usersCount,
      depositsAgg,
      withdrawalsAgg,
      tasksCount,
      completedToday,
      miningSum,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("deposits").select("amount_ton, status"),
      supabaseAdmin.from("withdrawals").select("amount, net_amount, status"),
      supabaseAdmin.from("tasks").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("user_tasks").select("id", { count: "exact", head: true })
        .eq("completed_on", new Date().toISOString().slice(0, 10)),
      supabaseAdmin.from("profiles").select("mining_rate, balance, deposit_total"),
    ]);

    const dep = depositsAgg.data ?? [];
    const wd = withdrawalsAgg.data ?? [];
    const ms = miningSum.data ?? [];

    return {
      users: usersCount.count ?? 0,
      tasks: tasksCount.count ?? 0,
      completedToday: completedToday.count ?? 0,
      deposits: {
        count: dep.length,
        totalTon: dep.reduce((s, r: any) => s + Number(r.amount_ton || 0), 0),
        confirmed: dep.filter((r: any) => r.status === "confirmed").length,
      },
      withdrawals: {
        count: wd.length,
        totalGram: wd.reduce((s, r: any) => s + Number(r.amount || 0), 0),
        pending: wd.filter((r: any) => r.status === "pending").length,
        paid: wd.filter((r: any) => r.status === "paid").length,
      },
      totals: {
        miningRate: ms.reduce((s, r: any) => s + Number(r.mining_rate || 0), 0),
        balance: ms.reduce((s, r: any) => s + Number(r.balance || 0), 0),
        depositTotal: ms.reduce((s, r: any) => s + Number(r.deposit_total || 0), 0),
      },
    };
  });

export const adminListTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await context.supabase
      .from("tasks").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

const TaskInput = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(2).max(64),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
  reward: z.number().nonnegative(),
  kind: z.enum(["daily", "once", "channel", "group"]),
  min_deposit: z.number().nonnegative().default(0),
  link: z.string().url().optional().nullable(),
  target_chat: z.string().max(200).optional().nullable(),
  is_active: z.boolean().default(true),
});

export const adminSaveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof TaskInput>) => TaskInput.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { id, ...fields } = data;
    if ((fields.kind === "channel" || fields.kind === "group") && !fields.target_chat) {
      throw new Error("target_chat es obligatorio para tareas de canal/grupo");
    }
    if (id) {
      const { error } = await context.supabase.from("tasks").update(fields).eq("id", id);
      if (error) throw error;
      return { ok: true, id };
    }
    const { data: inserted, error } = await context.supabase
      .from("tasks").insert(fields).select("id").maybeSingle();
    if (error) throw error;
    return { ok: true, id: inserted?.id };
  });

export const adminDeleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { error } = await context.supabase.from("tasks").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
