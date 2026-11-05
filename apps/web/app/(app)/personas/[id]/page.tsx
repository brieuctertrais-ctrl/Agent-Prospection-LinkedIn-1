import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { PersonaForm, type PersonaFormValues } from "../persona-form";

const EMPTY: PersonaFormValues = {
  name: "",
  job_titles: [],
  locations: ["France"],
  industries: [],
  company_sizes: [],
  keywords: [],
  formal_address: true,
  pitch: { title: "", description: "", benefits: "" },
  copy: { template: "", instructions: "", followup: "" },
};

export default async function PersonaEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const fromLinkedIn = id === "new" && (await searchParams).from === "linkedin";
  const { supabase, user } = await requireUser();
  const { t, locale } = await getT();

  let values = EMPTY;
  let suggested = false;
  if (fromLinkedIn) {
    // Latest onboarding suggestion of THIS user (RLS + explicit filter); only pre-fills the form.
    const { data: sug } = await supabase
      .from("linkedin_profiles_user")
      .select("suggestion")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const g = (sug?.suggestion ?? {}) as {
      persona?: Partial<PersonaFormValues>;
      pitch?: Partial<PersonaFormValues["pitch"]>;
      copywriting?: { instructions?: string; followup_instructions?: string };
    };
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    if (g.persona) {
      suggested = true;
      values = {
        ...EMPTY,
        name: typeof g.persona.name === "string" ? g.persona.name : "",
        job_titles: arr(g.persona.job_titles).slice(0, 10),
        locations: arr(g.persona.locations).length ? arr(g.persona.locations) : EMPTY.locations,
        industries: arr(g.persona.industries),
        company_sizes: arr(g.persona.company_sizes),
        keywords: arr(g.persona.keywords).slice(0, 10),
        pitch: {
          title: g.pitch?.title ?? "",
          description: g.pitch?.description ?? "",
          benefits: g.pitch?.benefits ?? "",
        },
        copy: { template: "", instructions: g.copywriting?.instructions ?? "", followup: g.copywriting?.followup_instructions ?? "" },
      };
    }
  }
  if (id !== "new") {
    const [persona, pitch, copy] = await Promise.all([
      supabase.from("personas").select("*").eq("id", id).maybeSingle(),
      supabase.from("pitches").select("*").eq("persona_id", id).maybeSingle(),
      supabase.from("copywriting_settings").select("*").eq("persona_id", id).maybeSingle(),
    ]);
    if (!persona.data) notFound();
    values = {
      ...persona.data,
      pitch: { title: pitch.data?.title ?? "", description: pitch.data?.description ?? "", benefits: pitch.data?.benefits ?? "" },
      copy: {
        template: copy.data?.template ?? "",
        instructions: copy.data?.instructions ?? "",
        followup: copy.data?.followup_instructions ?? "",
      },
    };
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold">{id === "new" ? t("personas.new") : values.name}</h1>
      {suggested && (
        <p className="mb-6 rounded-xl border border-gold/40 bg-gold/10 p-4 text-sm text-gold">{t("onb.banner")}</p>
      )}
      <PersonaForm values={values} locale={locale} />
    </div>
  );
}
