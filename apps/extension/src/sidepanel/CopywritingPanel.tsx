import { useEffect, useState } from "react";
import { PRODUCT_NAME } from "@kairo/shared";
import { supabase } from "../lib/supabase";
import { patchState } from "../lib/storage";
import { GhostButton, GoldButton } from "./components";

export function CopywritingPanel({
  personaId,
  onClose,
  noteMax,
  onNoteMax,
  t,
}: {
  personaId: string;
  onClose: () => void;
  noteMax: number;
  onNoteMax: (n: number) => void;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const [template, setTemplate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase
      .from("copywriting_settings")
      .select("template, instructions")
      .eq("persona_id", personaId)
      .maybeSingle()
      .then(({ data }) => {
        setTemplate(data?.template ?? "");
        setInstructions(data?.instructions ?? "");
      });
  }, [personaId]);

  const [maxChars, setMaxChars] = useState(noteMax);

  const save = async () => {
    if (maxChars !== noteMax) {
      onNoteMax(maxChars);
      await patchState({ noteMaxChars: maxChars });
    }
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("copywriting_settings").upsert({ persona_id: personaId, user_id: auth.user!.id, template, instructions });
    setBusy(false);
    setSaved(true);
    setTimeout(onClose, 800);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("copy.title")}</h2>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-300">{t("copy.template")}</span>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder={t("copy.templatePh", { name: PRODUCT_NAME })}
          className="min-h-[130px] w-full rounded-xl border border-white/10 bg-navy-dark p-3 text-sm outline-none focus:border-gold"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-300">{t("copy.instructions")}</span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={t("copy.instructionsPh")}
          className="min-h-[130px] w-full rounded-xl border border-white/10 bg-navy-dark p-3 text-sm outline-none focus:border-gold"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-300">{t("copy.noteMax")}</span>
        <select
          value={maxChars}
          onChange={(e) => setMaxChars(Number(e.target.value))}
          className="h-10 w-full rounded-xl border border-white/10 bg-navy-dark px-3 text-sm outline-none focus:border-gold"
        >
          <option value={300}>{t("copy.noteMax300")}</option>
          <option value={200}>{t("copy.noteMax200")}</option>
        </select>
      </label>
      <div className="flex gap-2">
        <GoldButton className="flex-1" onClick={save} disabled={busy}>{saved ? t("panel.settingsSaved") : t("common.save")}</GoldButton>
        <GhostButton onClick={onClose}>{t("common.cancel")}</GhostButton>
      </div>
    </div>
  );
}
