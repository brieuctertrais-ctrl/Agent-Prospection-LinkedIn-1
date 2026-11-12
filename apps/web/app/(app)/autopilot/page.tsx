import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { safePhotoUrl, safeProfileUrl } from "@/lib/leads";
import { Card } from "@/components/ui/card";
import { ReviewList, type QueueItem } from "./review-list";
import { PauseButton } from "./pause-button";
import { HealthCard, type HealthLine } from "./health-card";

export default async function AutopilotPage() {
  const { supabase } = await requireUser();
  const { t } = await getT();

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: rows }, { data: campaigns }, { data: problems }] = await Promise.all([
    supabase
      .from("action_queue")
      .select("id, action_type, status, payload, error, updated_at, prospect:prospects(full_name, headline, company, location, linkedin_url, photo_url, score, score_reason)")
      .in("action_type", ["invitation", "message"])
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("campaigns").select("id, status, paused_reason").in("status", ["running", "paused"]).order("updated_at", { ascending: false }).limit(1),
    // Own rows only (RLS). No profile URL is read: only the action, the date and the structural details.
    supabase
      .from("action_logs")
      .select("created_at, action_type, result, details")
      .gte("created_at", since)
      .or("result.eq.failure,action_type.eq.pause")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  // Health: failures grouped by cause + a copyable structural report (whitelisted keys only).
  const IGNORED = new Set(["already_connected", "replied", "not_connected", "quota_reached"]);
  const counts = new Map<string, number>();
  const entries: Record<string, unknown>[] = [];
  for (const p of problems ?? []) {
    const d = (p.details ?? {}) as Record<string, unknown>;
    const code = typeof d.code === "string" ? d.code.slice(0, 60) : "unknown";
    if (IGNORED.has(code)) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
    if (entries.length < 25) {
      entries.push({
        at: p.created_at,
        action: p.action_type,
        code,
        step: typeof d.step === "string" ? d.step.slice(0, 40) : undefined,
        detail: typeof d.detail === "string" ? d.detail.slice(0, 600) : undefined,
        build: typeof d.build === "string" ? d.build.slice(0, 40) : undefined,
        selectors: typeof d.selectors === "string" ? d.selectors.slice(0, 20) : undefined,
      });
    }
  }
  const healthLines: HealthLine[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => {
      const tr = t(`send.${code}` as Parameters<typeof t>[0]);
      return { code, count, label: tr.startsWith("send.") ? code : `${tr} (${code})` };
    });
  const healthReport = JSON.stringify({ kind: "efi-health", days: 7, counts: Object.fromEntries(counts), latest: entries });

  const messageIds = (rows ?? [])
    .map((r) => (r.payload as { message_id?: string } | null)?.message_id)
    .filter((id): id is string => Boolean(id));
  const { data: messages } = messageIds.length
    ? await supabase.from("messages").select("id, text").in("id", messageIds)
    : { data: [] as { id: string; text: string }[] };
  const textById = new Map((messages ?? []).map((m) => [m.id, m.text]));

  const items: QueueItem[] = (rows ?? []).map((r) => {
    const p = (Array.isArray(r.prospect) ? r.prospect[0] : r.prospect) as Record<string, string | number | null> | null;
    const payload = (r.payload ?? {}) as { message_id?: string; needs_approval?: boolean; kind?: string; no_note?: boolean };
    return {
      id: r.id,
      kind: r.action_type === "message" ? ("message" as const) : ("invitation" as const),
      msgKind: payload.kind ?? null,
      status: r.status,
      needsApproval: payload.needs_approval === true,
      noNote: payload.no_note === true,
      error: r.error,
      message: payload.message_id ? textById.get(payload.message_id) ?? "" : "",
      name: (p?.full_name as string) ?? "",
      headline: (p?.headline as string) ?? "",
      company: (p?.company as string) ?? "",
      location: (p?.location as string) ?? "",
      url: safeProfileUrl((p?.linkedin_url as string) ?? null),
      photo: safePhotoUrl((p?.photo_url as string) ?? null),
      score: typeof p?.score === "number" ? p.score : null,
    };
  });

  const toReview = items.filter((i) => i.status === "pending" && i.needsApproval && i.kind === "invitation");
  const followups = items.filter((i) => i.status === "pending" && i.needsApproval && i.kind === "message");
  const approved = items.filter((i) => i.status === "pending" && !i.needsApproval);
  const done = items.filter((i) => i.status === "done");
  const failed = items.filter((i) => i.status === "failed");
  const campaign = campaigns?.[0];

  const labels = {
    selectAll: t("apw.selectAll"),
    approve: t("apw.approve"),
    reject: t("apw.reject"),
    cancel: t("apw.cancel"),
    save: t("apw.saveMessage"),
    score: t("apw.score", { score: "{score}" }),
    error: t("common.error"),
    regenerate: t("apw.regenerate"),
    regenerating: t("apw.regenerating"),
    quota: t("err.quota_exceeded"),
    kindInvitation: t("apw.kind.invitation"),
    kindMessage: t("apw.kind.message"),
    followup_1: t("apw.kind.followup_1"),
    followup_2: t("apw.kind.followup_2"),
    followup_3: t("apw.kind.followup_3"),
    followup_4: t("apw.kind.followup_4"),
    replied: t("apw.replied"),
    repliedHelp: t("apw.repliedHelp"),
    noNote: t("apw.noNote"),
    retry: t("apw.retry"),
    retryHelp: t("apw.retryHelp"),
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t("apw.title")}</h1>
        <p className="mt-1 text-slate-400">{t("apw.subtitle")}</p>
      </div>

      <HealthCard
        lines={healthLines}
        report={healthReport}
        labels={{
          title: t("apw.health.title"),
          ok: t("apw.health.ok"),
          issues: t("apw.health.issues"),
          copy: t("apw.health.copy"),
          copied: t("apw.health.copied"),
          help: t("apw.health.help"),
        }}
      />

      {campaign && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            {campaign.status === "running"
              ? t("apw.running")
              : `${t("apw.paused", { reason: campaign.paused_reason ?? "" })} — ${t("apw.resumeHint")}`}
          </p>
          {campaign.status === "running" && <PauseButton campaignId={campaign.id} label={t("apw.pause")} />}
        </Card>
      )}

      {followups.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("apw.followups")} ({followups.length})</h2>
          <p className="text-sm text-slate-400">{t("apw.followupsHelp")}</p>
          <ReviewList items={followups} mode="review" labels={labels} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t("apw.toReview")} ({toReview.length})</h2>
        {toReview.length === 0 ? (
          <Card className="flex items-center gap-4 p-5">
            <img src="/mascot.svg" alt="" width={56} height={56} className="h-14 w-14" />
            <p className="text-slate-300">{t("apw.empty")}</p>
          </Card>
        ) : (
          <>
            <ReviewList items={toReview} mode="review" labels={labels} />
            <p className="text-sm text-slate-400">{t("apw.howTo")}</p>
          </>
        )}
      </section>

      {approved.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("apw.approved")} ({approved.length})</h2>
          <ReviewList items={approved} mode="approved" labels={labels} />
        </section>
      )}

      {failed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("apw.failed")} ({failed.length})</h2>
          <ReviewList items={failed.slice(0, 50)} mode="readonly" labels={labels} />
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("apw.done")} ({done.length})</h2>
          <ReviewList items={done.slice(0, 50)} mode="readonly" labels={labels} />
        </section>
      )}
    </div>
  );
}
