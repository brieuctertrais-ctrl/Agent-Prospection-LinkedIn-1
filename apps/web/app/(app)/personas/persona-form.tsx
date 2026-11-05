"use client";
import { useActionState } from "react";
import Link from "next/link";
import { COMPANY_SIZES, INDUSTRIES, LOCATIONS, MAX_JOB_TITLES, MAX_KEYWORDS, PRODUCT_NAME, translate, type Locale } from "@kairo/shared";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChipsInput } from "@/components/ui/chips-input";
import { MultiSelect } from "@/components/ui/multi-select";
import { savePersona, type SaveState } from "./actions";

export interface PersonaFormValues {
  id?: string;
  name: string;
  job_titles: string[];
  locations: string[];
  industries: string[];
  company_sizes: string[];
  keywords: string[];
  formal_address: boolean;
  pitch: { title: string; description: string; benefits: string };
  copy: { template: string; instructions: string };
}

export function PersonaForm({ values, locale }: { values: PersonaFormValues; locale: Locale }) {
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string>) => translate(locale, k, v);
  const [state, action, pending] = useActionState<SaveState, FormData>(savePersona, {});

  return (
    <form action={action} className="space-y-6">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>{t("persona.title")}</CardTitle>
          <div className="space-y-5">
            <div>
              <Label htmlFor="name">{t("persona.nickname")}</Label>
              <Input id="name" name="name" required defaultValue={values.name} placeholder="Commercial BtoB (FR)" />
            </div>
            <div>
              <Label>{t("persona.jobTitles")}</Label>
              <ChipsInput name="job_titles" max={MAX_JOB_TITLES} defaultValue={values.job_titles} addLabel={t("common.add")} placeholder="SDR" />
            </div>
            <div>
              <Label>{t("persona.locations")}</Label>
              <MultiSelect name="locations" options={LOCATIONS.map((l) => l.label)} defaultValue={values.locations} allowCustom addLabel={t("common.add")} />
            </div>
            <div>
              <Label>{t("persona.industries")}</Label>
              <MultiSelect name="industries" options={INDUSTRIES.map((i) => i.label)} defaultValue={values.industries} />
            </div>
            <div>
              <Label>{t("persona.companySizes")}</Label>
              <MultiSelect name="company_sizes" options={[...COMPANY_SIZES]} defaultValue={values.company_sizes} />
            </div>
            <div>
              <Label>{t("persona.keywords")}</Label>
              <ChipsInput name="keywords" max={MAX_KEYWORDS} prefix="#" defaultValue={values.keywords} addLabel={t("common.add")} placeholder="prospection" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" name="formal_address" defaultChecked={values.formal_address} className="accent-[#F5C451]" />
              {t("persona.formal")}
            </label>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle>{t("pitch.title")}</CardTitle>
            <div className="space-y-5">
              <div>
                <Label htmlFor="pitch_title">{t("pitch.offerTitle")}</Label>
                <Input id="pitch_title" name="pitch_title" defaultValue={values.pitch.title} />
              </div>
              <div>
                <Label htmlFor="pitch_description">{t("pitch.description")}</Label>
                <Textarea id="pitch_description" name="pitch_description" defaultValue={values.pitch.description} />
              </div>
              <div>
                <Label htmlFor="pitch_benefits">{t("pitch.benefits")}</Label>
                <Textarea id="pitch_benefits" name="pitch_benefits" defaultValue={values.pitch.benefits} />
              </div>
            </div>
          </Card>
          <Card>
            <CardTitle>{t("copy.title")}</CardTitle>
            <div className="space-y-5">
              <div>
                <Label htmlFor="copy_template">{t("copy.template")}</Label>
                <Textarea id="copy_template" name="copy_template" defaultValue={values.copy.template} placeholder={t("copy.templatePh", { name: PRODUCT_NAME })} />
              </div>
              <div>
                <Label htmlFor="copy_instructions">{t("copy.instructions")}</Label>
                <Textarea id="copy_instructions" name="copy_instructions" defaultValue={values.copy.instructions} placeholder={t("copy.instructionsPh")} />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
          {state.error === "persona_limit_reached"
            ? t("personas.limit")
            : state.error === "invalid_request"
              ? `${t("common.invalid")}${state.fields?.length ? ` (${state.fields.join(", ")})` : ""}`
              : t("common.error")}
        </p>
      )}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{t("common.save")}</Button>
        <Link href="/personas"><Button type="button" variant="ghost">{t("common.cancel")}</Button></Link>
      </div>
    </form>
  );
}
