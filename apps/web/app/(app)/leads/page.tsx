import { Download, ExternalLink } from "lucide-react";
import { LEAD_STATUSES, type LeadStatus } from "@kairo/shared";
import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { fetchLeads } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusSelect } from "./status-select";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ persona?: string; status?: string; q?: string }>;
}) {
  const filters = await searchParams;
  const { supabase, user } = await requireUser();
  const { t, locale } = await getT();
  const [leads, { data: personas }, { data: paid }] = await Promise.all([
    fetchLeads(supabase, filters),
    supabase.from("personas").select("id, name").order("created_at"),
    supabase.rpc("is_paid"),
  ]);
  // Opening the page clears the "New" badge.
  await supabase.from("leads").update({ seen_at: new Date().toISOString() }).eq("user_id", user.id).is("seen_at", null);

  const statusLabels = Object.fromEntries(LEAD_STATUSES.map((s) => [s, t(`status.${s}`)])) as Record<LeadStatus, string>;
  const exportQs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("leads.title")}</h1>
        {paid ? (
          <a href={`/api/leads/export?${exportQs}`}>
            <Button variant="secondary"><Download className="h-4 w-4" /> {t("leads.export")}</Button>
          </a>
        ) : (
          <Button variant="secondary" disabled title={t("leads.exportPaid")}>
            <Download className="h-4 w-4" /> {t("leads.export")} 🔒
          </Button>
        )}
      </div>

      <form className="mb-4 flex flex-wrap gap-3">
        <Input name="q" defaultValue={filters.q} placeholder={t("common.search")} className="w-64" />
        <Select name="persona" defaultValue={filters.persona ?? ""}>
          <option value="">{t("leads.allPersonas")}</option>
          {(personas ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select name="status" defaultValue={filters.status ?? ""}>
          <option value="">{t("leads.allStatuses")}</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
        </Select>
        <Button type="submit" variant="outline">{t("common.search")}</Button>
      </form>

      {leads.length === 0 ? (
        <div className="flex items-center gap-4 rounded-2xl bg-navy-light p-8">
          <img src="/mascot.svg" alt="" className="h-16 w-16" />
          <p className="text-slate-300">{t("leads.empty")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/5 bg-navy-light">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/5 text-xs uppercase text-slate-400">
              <tr>
                {(["name", "title", "company", "location", "persona", "message", "date", "status"] as const).map((c) => (
                  <th key={c} className="px-4 py-3 font-medium">{t(`leads.col.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-white/5 align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {l.prospect.photo_url ? (
                        <img src={l.prospect.photo_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-lighter">
                          {(l.prospect.full_name ?? "?").slice(0, 1)}
                        </span>
                      )}
                      <a href={l.prospect.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-gold">
                        {l.prospect.full_name} <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </td>
                  <td className="max-w-[220px] px-4 py-3 text-slate-300">{l.prospect.headline}</td>
                  <td className="px-4 py-3 text-slate-300">{l.prospect.company}</td>
                  <td className="px-4 py-3 text-slate-300">{l.prospect.location}</td>
                  <td className="px-4 py-3 text-slate-300">{l.persona?.name}</td>
                  <td className="max-w-[320px] px-4 py-3">
                    <p className="line-clamp-3 rounded-lg bg-cream p-2 text-xs text-navy">{l.message?.text}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {new Date(l.created_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US")}
                  </td>
                  <td className="px-4 py-3">
                    <StatusSelect id={l.id} value={l.status} labels={statusLabels} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
