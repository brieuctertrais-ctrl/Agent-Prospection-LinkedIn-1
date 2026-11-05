"use client";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractText, MAX_CHARS } from "@/lib/extract-text";
import { addDoc } from "./actions";

type Labels = Record<
  "title" | "content" | "save" | "import" | "importHelp" | "reading" | "truncated" | "tooLarge" | "unsupported" | "noText" | "error",
  string
>;

/** Add a document: typed text, or text extracted locally from a PDF / TXT / MD file (reviewed before saving). */
export function KnowledgeForm({ labels }: { labels: Labels }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [note, setNote] = useState<string>();
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await addDoc(fd);
        setTitle("");
        setContent("");
        setNote(undefined);
      }}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setReading(true);
            setNote(undefined);
            try {
              const r = await extractText(file);
              setTitle(r.title);
              setContent(r.text);
              if (r.truncated) setNote(labels.truncated);
            } catch (err) {
              const code = err instanceof Error ? err.message : "";
              setNote(
                code === "file_too_large"
                  ? labels.tooLarge
                  : code === "unsupported_type"
                    ? labels.unsupported
                    : code === "no_text"
                      ? labels.noText
                      : labels.error,
              );
            } finally {
              setReading(false);
            }
          }}
        />
        <Button type="button" variant="secondary" disabled={reading} onClick={() => fileRef.current?.click()}>
          <FileUp className="h-4 w-4" /> {reading ? labels.reading : labels.import}
        </Button>
        <span className="text-xs text-slate-500">{labels.importHelp}</span>
      </div>
      {note && <p className="rounded-lg bg-gold/10 p-3 text-sm text-gold">{note}</p>}
      <div>
        <Label htmlFor="title">{labels.title}</Label>
        <Input id="title" name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="content">{labels.content}</Label>
        <Textarea
          id="content"
          name="content"
          required
          maxLength={MAX_CHARS}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[220px]"
        />
        <p className="mt-1 text-right text-xs text-slate-500">
          {content.length.toLocaleString("fr-FR")} / {MAX_CHARS.toLocaleString("fr-FR")}
        </p>
      </div>
      <Button type="submit">{labels.save}</Button>
    </form>
  );
}
