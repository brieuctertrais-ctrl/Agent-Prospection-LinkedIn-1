import Link from "next/link";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WeeklyChart, type Week } from "./weekly-chart";
import { Funnel, Tile } from "./stats-parts";

interface Stats {
  days: number;
  views: number;
  approved: number;
  invited: number;
  accepted: number;
  replied: number;
  meetings: number;
  messages: number;
  weekly: Week[];
  personas: { name: string; invited: number; accepted: number; replied: number; meetings: number }[];
}

const PERIODS = [7, 30, 90] as const;
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null);

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const days = z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).catch(30).parse((await searchParams).days);
  const { supabase } = await requireUser();
  const { t, locale } = await getT();
  const { data, error } = await supabase.rpc("get_stats", { p_days: days });
  const s = (data ?? null) as Stats | null;

  const fmtPct = (v: number | null) => (v === null ? "—" : `${v} %`);

  return (
    <div className="viz-root mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("stats.title")}</h1>
          <p className="mt-1 text-slate-400">{t("stats.subtitle")}</p>
        </div>
        {/* Period filter: one row above the charts */}
        <div className="flex rounded-xl bg-navy-light p-1 text-sm" role="tablist" aria-label={t("stats.period")}>
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/stats?days=${p}`}
              role="tab"
              aria-selected={p === days}
              className={cn("rounded-lg px-3 py-1.5 font-semibold", p === days ? "bg-gold text-navy" : "text-slate-300 hover:text-white")}
            >
              {t("stats.days", { n: p })}
            </Link>
          ))}
        </div>
      </div>

      {error || !s ? (
        <p className="rounded-xl bg-red-500/10 p-4 text-sm text-red-300">{t("common.error")}</p>
      ) : (
        <>
          {/* KPI row */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={t("stats.kpi.invited")} value={String(s.invited)} hint={t("stats.kpi.invitedHint", { n: s.days })} />
            <Tile label={t("stats.kpi.acceptance")} value={fmtPct(pct(s.accepted, s.invited))} hint={t("stats.kpi.of", { a: s.accepted, b: s.invited })} />
            <Tile label={t("stats.kpi.reply")} value={fmtPct(pct(s.replied, s.accepted))} hint={t("stats.kpi.of", { a: s.replied, b: s.accepted })} />
            <Tile label={t("stats.kpi.meetings")} value={String(s.meetings)} hint={t("stats.kpi.meetingsHint", { n: s.messages })} />
          </section>

          {s.invited === 0 && s.views === 0 ? (
            <div className="flex items-center gap-4 rounded-2xl bg-navy-light p-6">
              <img src="/mascot.svg" alt="" width={56} height={56} className="h-14 w-14" />
              <p className="text-slate-300">{t("stats.empty")}</p>
            </div>
          ) : (
            <>
              <Funnel
                title={t("stats.funnel.title")}
                help={t("stats.funnel.help")}
                stages={[
                  { label: t("stats.funnel.views"), value: s.views },
                  { label: t("stats.funnel.approved"), value: s.approved },
                  { label: t("stats.funnel.invited"), value: s.invited },
                  { label: t("stats.funnel.accepted"), value: s.accepted },
                  { label: t("stats.funnel.replied"), value: s.replied },
                  { label: t("stats.funnel.meetings"), value: s.meetings },
                ]}
                ofPrevious={t("stats.funnel.ofPrevious")}
              />

              <section className="rounded-2xl bg-navy-light p-6">
                <h2 className="text-lg font-semibold">{t("stats.weekly.title")}</h2>
                <p className="mb-4 text-sm text-slate-400">{t("stats.weekly.help")}</p>
                <WeeklyChart
                  weeks={s.weekly}
                  locale={locale}
                  labels={{
                    invited: t("stats.weekly.invited"),
                    accepted: t("stats.weekly.accepted"),
                    weekOf: t("stats.weekly.weekOf"),
                    rate: t("stats.kpi.acceptance"),
                  }}
                />
              </section>

              <section className="rounded-2xl bg-navy-light p-6">
                <h2 className="mb-4 text-lg font-semibold">{t("stats.personas.title")}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="text-xs uppercase text-slate-400">
                      <tr>
                        <th className="py-2 pr-4 font-medium">{t("stats.personas.persona")}</th>
                        <th className="py-2 pr-4 text-right font-medium">{t("stats.funnel.invited")}</th>
                        <th className="py-2 pr-4 text-right font-medium">{t("stats.kpi.acceptance")}</th>
                        <th className="py-2 pr-4 text-right font-medium">{t("stats.kpi.reply")}</th>
                        <th className="py-2 text-right font-medium">{t("stats.funnel.meetings")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.personas.map((p) => (
                        <tr key={p.name} className="border-t border-white/5">
                          <td className="py-2 pr-4">{p.name}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{p.invited}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{fmtPct(pct(p.accepted, p.invited))}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{fmtPct(pct(p.replied, p.accepted))}</td>
                          <td className="py-2 text-right tabular-nums">{p.meetings}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
