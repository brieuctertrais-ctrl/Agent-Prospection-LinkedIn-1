import { Trash2 } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { deleteDoc } from "./actions";
import { KnowledgeForm } from "./knowledge-form";

export default async function KnowledgePage() {
  const { supabase } = await requireUser();
  const { t } = await getT();
  const { data: docs } = await supabase.from("knowledge_docs").select("id, title, content").order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("knowledge.title")}</h1>
        <p className="text-slate-400">{t("knowledge.subtitle")}</p>
      </div>
      <Card>
        <KnowledgeForm
          labels={{
            title: t("knowledge.docTitle"),
            content: t("knowledge.docContent"),
            save: t("common.save"),
            import: t("knowledge.import"),
            importHelp: t("knowledge.importHelp"),
            reading: t("knowledge.reading"),
            truncated: t("knowledge.truncated"),
            tooLarge: t("knowledge.tooLarge"),
            unsupported: t("knowledge.unsupported"),
            noText: t("knowledge.noText"),
            error: t("common.error"),
          }}
        />
      </Card>
      {(docs ?? []).map((d) => (
        <Card key={d.id} className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-semibold">{d.title}</h3>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-slate-400">{d.content}</p>
            </div>
            <form action={deleteDoc}>
              <input type="hidden" name="id" value={d.id} />
              <Button variant="ghost" size="icon" aria-label={t("common.delete")}><Trash2 className="h-4 w-4" /></Button>
            </form>
          </div>
        </Card>
      ))}
    </div>
  );
}
