"use server";
import { revalidatePath } from "next/cache";
import { LEAD_STATUSES, type LeadStatus } from "@kairo/shared";
import { requireUser } from "@/lib/supabase/server";

export async function updateLeadStatus(leadId: string, status: LeadStatus) {
  if (!LEAD_STATUSES.includes(status)) throw new Error("invalid_status");
  const { supabase } = await requireUser();
  await supabase.from("leads").update({ status, last_action: `status:${status}` }).eq("id", leadId);
  revalidatePath("/leads");
}
