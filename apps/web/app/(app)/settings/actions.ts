"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

const int = (fd: FormData, k: string, min: number, max: number) => {
  const n = Math.round(Number(fd.get(k)));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

export async function saveSettings(fd: FormData) {
  const { supabase, user } = await requireUser();
  const locale = fd.get("locale") === "en" ? "en" : "fr";
  (await cookies()).set("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  await supabase.from("profiles").update({ locale }).eq("id", user.id);
  await supabase
    .from("user_settings")
    .update({
      daily_profile_views: int(fd, "daily_profile_views", 1, 300),
      daily_invitations: int(fd, "daily_invitations", 1, 100),
      weekly_invitations: int(fd, "weekly_invitations", 1, 200),
      daily_messages: int(fd, "daily_messages", 1, 150),
      min_match_score: int(fd, "min_match_score", 0, 100),
      work_start_hour: int(fd, "work_start_hour", 0, 23),
      work_end_hour: int(fd, "work_end_hour", 1, 24),
      timezone: String(fd.get("timezone") || "Europe/Paris").slice(0, 64),
    })
    .eq("user_id", user.id);
  revalidatePath("/", "layout");
}

export async function deleteProspectingData() {
  const { supabase } = await requireUser();
  await supabase.rpc("delete_my_prospecting_data");
  revalidatePath("/", "layout");
}
