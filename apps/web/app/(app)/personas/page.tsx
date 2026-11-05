import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ProspectButton } from "@/components/prospect-button";

export default async function PersonasPage() {
  const { supabase, user } = await requireUser();
  const { t } = await getT();
  const [{ data: profile }, { data: personas }] = await Promise.all([
    supabase.from("profiles").select("first_name").eq("id", user.id).single(),
    supabase.from("personas").select("id, name, job_titles, locations").order("created_at"),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-3xl font-bold">{t("personas.hello", { firstName: profile?.first_name ?? "" })}</h1>
      <p className="mb-8 text-2xl font-semibold text-slate-300">{t("personas.subtitle")}</p>

      <div className="space-y-3">
        {(personas ?? []).length === 0 && (
          <div className="flex items-center gap-4 rounded-2xl bg-navy-light p-6">
            <img src="/mascot.svg" alt="" width={64} height={64} className="h-16 w-16" />
            <p className="text-slate-300">{t("personas.empty")}</p>
          </div>
        )}
        {(personas ?? []).map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-2xl bg-navy-light px-6 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{p.name}</span>
                <Link href={`/personas/${p.id}`} aria-label={t("common.edit")} className="text-slate-400 hover:text-gold">
                  <Pencil className="h-4 w-4" />
                </Link>
              </div>
              <p className="truncate text-sm text-slate-400">
                {[p.job_titles.join(", "), p.locations.join(", ")].filter(Boolean).join(" · ")}
              </p>
            </div>
            <ProspectButton label={t("cta.prospect")} personaId={p.id} size="sm" />
          </div>
        ))}
      </div>

      <Link href="/personas/new" className="mt-4 inline-block">
        <Button variant="outline">
          <Plus className="h-4 w-4" /> {t("personas.new")}
        </Button>
      </Link>

      <div className="mt-16 flex items-center justify-between rounded-2xl border border-dashed border-white/10 p-6">
        <p className="text-slate-300">{t("personas.needMore")}</p>
        <a href={process.env.NEXT_PUBLIC_CONTACT_URL ?? "mailto:contact@example.com"}>
          <Button variant="secondary">{t("personas.talkToTeam")}</Button>
        </a>
      </div>
    </div>
  );
}
