"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LEAD_STATUSES, type LeadStatus } from "@kairo/shared";
import { requireUser } from "@/lib/supabase/server";

const Schema = z.object({ id: z.string().uuid(), status: z.enum(LEAD_STATUSES) });

export async function updateLeadStatus(leadId: string, status: LeadStatus) {
  const parsed = Schema.safeParse({ id: leadId, status });
  if (!parsed.success) return { error: "invalid_request" };
  const { supabase, user } = await requireUser();
  // RLS + explicit owner filter: another user's lead id updates nothing.
  const { error } = await supabase
    .from("leads")
    .update({ status: parsed.data.status, last_action: `status:${parsed.data.status}` })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);
  if (error) return { error: "update_failed" };
  revalidatePath("/leads");
  return {};
}
