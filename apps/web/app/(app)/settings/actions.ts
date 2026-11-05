"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const SettingsSchema = z
  .object({
    locale: z.enum(["fr", "en"]),
    daily_profile_views: int(1, 300),
    daily_invitations: int(1, 100),
    weekly_invitations: int(1, 200),
    daily_messages: int(1, 150),
    min_match_score: int(0, 100),
    work_start_hour: int(0, 23),
    work_end_hour: int(1, 24),
    timezone: z.string().trim().min(1).max(64).refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }),
  })
  .refine((s) => s.work_end_hour > s.work_start_hour);

export async function saveSettings(fd: FormData) {
  const parsed = SettingsSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return;
  const { locale, ...settings } = parsed.data;
  const { supabase, user } = await requireUser();
  (await cookies()).set("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  await supabase.from("profiles").update({ locale }).eq("id", user.id);
  await supabase.from("user_settings").update(settings).eq("user_id", user.id);
  revalidatePath("/", "layout");
}

export async function deleteProspectingData() {
  const { supabase } = await requireUser();
  await supabase.rpc("delete_my_prospecting_data");
  revalidatePath("/", "layout");
}
