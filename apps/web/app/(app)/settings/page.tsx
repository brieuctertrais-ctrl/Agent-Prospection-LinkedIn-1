import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { deleteProspectingData, saveSettings } from "./actions";

const FIELDS = [
  ["daily_profile_views", "Profils consultés / jour"],
  ["daily_invitations", "Invitations / jour"],
  ["weekly_invitations", "Invitations / semaine"],
  ["daily_messages", "Messages / jour"],
  ["min_match_score", "Score minimum de correspondance (0-100)"],
  ["min_delay_seconds", "Délai minimum entre deux invitations (s)"],
  ["max_delay_seconds", "Délai maximum entre deux invitations (s)"],
  ["work_start_hour", "Début de plage horaire (h)"],
  ["purge_rejected_after_months", "Conservation des profils rejetés (mois, 1 à 36)"],
  ["work_end_hour", "Fin de plage horaire (h)"],
] as const;

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const { t, locale } = await getT();
  const [{ data: s }, { data: sub }] = await Promise.all([
    supabase.from("user_settings").select("*").eq("user_id", user.id).single(),
    supabase.from("subscriptions").select("plan, status, trial_ends_at").eq("user_id", user.id).single(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
      {sub && (
        <Card className="p-5 text-sm">
          Offre : <b className="text-gold">{sub.plan}</b>
          {sub.plan === "trial" && <> — essai jusqu&apos;au {new Date(sub.trial_ends_at).toLocaleDateString("fr-FR")}</>}
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
            {FIELDS.map(([k, label]) => (
              <div key={k}>
                <Label htmlFor={k}>{label}</Label>
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
                    aria-label={`J+ ${i + 1}`}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="timezone">Fuseau horaire</Label>
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
