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
  copy: { template: "", instructions: "" },
};

export default async function PersonaEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { t, locale } = await getT();

  let values = EMPTY;
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
      copy: { template: copy.data?.template ?? "", instructions: copy.data?.instructions ?? "" },
    };
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold">{id === "new" ? t("personas.new") : values.name}</h1>
      <PersonaForm values={values} locale={locale} />
    </div>
  );
}
