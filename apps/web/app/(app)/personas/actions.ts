"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MAX_JOB_TITLES, MAX_KEYWORDS } from "@kairo/shared";
import { requireUser } from "@/lib/supabase/server";

const list = (fd: FormData, k: string) =>
  fd.getAll(k).map(String).map((s) => s.trim()).filter(Boolean);

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  job_titles: z.array(z.string().max(80)).max(MAX_JOB_TITLES),
  locations: z.array(z.string().max(80)).max(20),
  industries: z.array(z.string().max(120)).max(30),
  company_sizes: z.array(z.string().max(20)).max(10),
  keywords: z.array(z.string().max(60)).max(MAX_KEYWORDS),
  formal_address: z.boolean(),
  pitch_title: z.string().max(120),
  pitch_description: z.string().max(3000),
  pitch_benefits: z.string().max(3000),
  copy_template: z.string().max(2000),
  copy_instructions: z.string().max(2000),
});

export type SaveState = { error?: string; fields?: string[] };

function logAndFail(where: string, code: string): SaveState {
  console.error(JSON.stringify({ where, code }));
  return { error: "save_failed" };
}

export async function savePersona(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { supabase, user } = await requireUser();
  const rawId = fd.get("id");
  const idParsed = z.string().uuid().nullable().safeParse(rawId ? String(rawId) : null);
  if (!idParsed.success) return { error: "invalid_request" };
  const id = idParsed.data;

  const parsed = schema.safeParse({
    name: fd.get("name"),
    job_titles: list(fd, "job_titles"),
    locations: list(fd, "locations"),
    industries: list(fd, "industries"),
    company_sizes: list(fd, "company_sizes"),
    keywords: list(fd, "keywords"),
    formal_address: fd.get("formal_address") === "on",
    pitch_title: String(fd.get("pitch_title") ?? ""),
    pitch_description: String(fd.get("pitch_description") ?? ""),
    pitch_benefits: String(fd.get("pitch_benefits") ?? ""),
    copy_template: String(fd.get("copy_template") ?? ""),
    copy_instructions: String(fd.get("copy_instructions") ?? ""),
  });
  if (!parsed.success) return { error: "invalid_request", fields: parsed.error.issues.map((i) => String(i.path[0])) };
  const v = parsed.data;

  const personaRow = {
    user_id: user.id,
    name: v.name,
    job_titles: v.job_titles,
    locations: v.locations,
    industries: v.industries,
    company_sizes: v.company_sizes,
    keywords: v.keywords,
    formal_address: v.formal_address,
  };

  let personaId = id;
  if (id) {
    // Ownership check: the persona must belong to the session user (never trust the id from the form).
    const { data: owned, error } = await supabase
      .from("personas")
      .update(personaRow)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) return logAndFail("persona_update", error.code);
    if (!owned) return { error: "not_found" };
  } else {
    const { data, error } = await supabase.from("personas").insert(personaRow).select("id").single();
    if (error) return error.message.includes("persona_limit_reached") ? { error: "persona_limit_reached" } : logAndFail("persona_insert", error.code);
    personaId = data.id;
    // First persona becomes the active one in the extension.
    await supabase.from("user_settings").update({ active_persona_id: personaId }).is("active_persona_id", null);
  }

  const [p, c] = await Promise.all([
    supabase.from("pitches").upsert({
      persona_id: personaId,
      user_id: user.id,
      title: v.pitch_title,
      description: v.pitch_description,
      benefits: v.pitch_benefits,
    }),
    supabase.from("copywriting_settings").upsert({
      persona_id: personaId,
      user_id: user.id,
      template: v.copy_template,
      instructions: v.copy_instructions,
    }),
  ]);
  if (p.error || c.error) return logAndFail("pitch_copy_upsert", (p.error ?? c.error)!.code);

  revalidatePath("/personas");
  redirect("/personas");
}

export async function deletePersona(fd: FormData) {
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  const { supabase, user } = await requireUser();
  await supabase.from("personas").delete().eq("id", id.data).eq("user_id", user.id);
  revalidatePath("/personas");
}
