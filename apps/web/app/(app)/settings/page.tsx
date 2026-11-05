import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { deleteProspectingData, saveSettings } from "./actions";

const FIELDS = [
  "daily_profile_views",
  "daily_invitations",
  "weekly_invitations",
  "daily_messages",
  "min_match_score",
  "min_delay_seconds",
  "max_delay_seconds",
  "work_start_hour",
  "purge_rejected_after_months",
  "work_end_hour",
] as const;

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const { t, locale } = await getT();
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const [{ data: s }, { data: sub }] = await Promise.all([
    supabase.from("user_settings").select("*").eq("user_id", user.id).single(),
    supabase.from("subscriptions").select("plan, status, trial_ends_at").eq("user_id", user.id).single(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
      {sub && (
        <Card className="p-5 text-sm">
          {t("settings.plan")} <b className="text-gold">{sub.plan === "trial" ? t("settings.plan.trial") : sub.plan}</b>
          {sub.plan === "trial" && sub.trial_ends_at && (
            <> — {t("settings.trialUntil", { date: new Date(sub.trial_ends_at).toLocaleDateString(dateLocale) })}</>
          )}
        </Card>
      )}
      <Card>
        <form action={saveSettings} className="space-y-5">
          <div>
            <Label htmlFor="locale">{t("settings.language")}</Label>
            <Select id="locale" name="locale" defaultValue={locale}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </div>
          <CardTitle className="mb-0 mt-4">{t("settings.quotas")}</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((k) => (
              <div key={k}>
                <Label htmlFor={k}>{t(`settings.field.${k}`)}</Label>
                <Input id={k} name={k} type="number" defaultValue={s?.[k]} />
              </div>
            ))}
            <div className="sm:col-span-2">
              <Label>{t("settings.followupDelays")}</Label>
              <div className="flex gap-3">
                {[0, 1, 2].map((i) => (
                  <Input
                    key={i}
                    name={`delay_${i + 1}`}
                    type="number"
                    min={1}
                    max={120}
                    defaultValue={(s?.followup_delays as number[] | undefined)?.[i] ?? [3, 7, 14][i]}
                    aria-label={t("settings.followupDay", { n: i + 2 })}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="timezone">{t("settings.timezone")}</Label>
              <Input id="timezone" name="timezone" defaultValue={s?.timezone} />
            </div>
          </div>
          <Button type="submit">{t("common.save")}</Button>
        </form>
      </Card>
      <Card className="p-5 text-sm text-slate-300">
        <p className="mb-2 font-semibold text-white">{t("settings.retention.title")}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("settings.retention.rejected")}</li>
          <li>{t("settings.retention.viewed")}</li>
          <li>{t("settings.retention.noReply")}</li>
          <li>{t("settings.retention.kept")}</li>
          <li>{t("settings.retention.exclusion")}</li>
        </ul>
      </Card>
      <Card className="border-red-500/20">
        <form action={deleteProspectingData}>
          <Button variant="destructive" type="submit">{t("settings.deleteData")}</Button>
        </form>
      </Card>
    </div>
  );
}
