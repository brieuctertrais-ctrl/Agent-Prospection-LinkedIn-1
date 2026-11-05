"use client";
import { useState, useTransition } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelQueueItem, regenerateMessages, reviewBatch, updateQueuedMessage } from "./actions";

export interface QueueItem {
  id: string;
  kind: "invitation" | "message";
  status: string;
  needsApproval: boolean;
  error: string | null;
  message: string;
  name: string;
  headline: string;
  company: string;
  location: string;
  url: string | null;
  photo: string | null;
  score: number | null;
}

type Labels = Record<
  "selectAll" | "approve" | "reject" | "cancel" | "save" | "score" | "error" | "regenerate" | "regenerating" | "quota" | "kindInvitation" | "kindMessage",
  string
>;

export function ReviewList({ items, mode, labels }: { items: QueueItem[]; mode: "review" | "approved" | "readonly"; labels: Labels }) {
  const [selected, setSelected] = useState<string[]>(mode === "review" ? items.map((i) => i.id) : []);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.error ? (r.error === labels.quota ? labels.quota : labels.error) : undefined);
      if (!r.error) setSelected([]);
    });

  return (
    <div className="space-y-3">
      {mode === "review" && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="accent-[#F5C451]"
              checked={selected.length === items.length}
              onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.id) : [])}
            />
            {labels.selectAll} ({selected.length}/{items.length})
          </label>
          <Button disabled={pending || selected.length === 0} onClick={() => run(() => reviewBatch(selected, []))}>
            {labels.approve}
          </Button>
          <Button variant="outline" disabled={pending || selected.length === 0} onClick={() => run(() => reviewBatch([], selected))}>
            {labels.reject}
          </Button>
          <Button
            variant="secondary"
            disabled={pending || selected.length === 0 || selected.length > 20}
            onClick={() =>
              run(async () => {
                const r = await regenerateMessages(selected);
                return r.error === "quota" ? { error: labels.quota } : r.error ? { error: r.error } : {};
              })
            }
            title="20 max"
          >
            <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} /> {pending ? labels.regenerating : labels.regenerate}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
      {items.map((item) => (
        <Row
          key={item.id}
          item={item}
          mode={mode}
          labels={labels}
          checked={selected.includes(item.id)}
          onToggle={() => toggle(item.id)}
          onCancel={() => run(() => cancelQueueItem(item.id))}
          busy={pending}
        />
      ))}
    </div>
  );
}

function Row({
  item,
  mode,
  labels,
  checked,
  onToggle,
  onCancel,
  busy,
}: {
  item: QueueItem;
  mode: "review" | "approved" | "readonly";
  labels: Labels;
  checked: boolean;
  onToggle: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [text, setText] = useState(item.message);
  const [lastServerText, setLastServerText] = useState(item.message);
  if (item.message !== lastServerText) {
    // A regenerated message arrived from the server: show it.
    setLastServerText(item.message);
    setText(item.message);
  }
  const [saving, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const editable = mode !== "readonly";
  const chars = [...text].length;
  const max = item.kind === "message" ? 1000 : 300;

  return (
    <div className="flex gap-4 rounded-2xl border border-white/5 bg-navy-light p-4">
      {mode === "review" && <input type="checkbox" className="mt-1 h-4 w-4 accent-[#F5C451]" checked={checked} onChange={onToggle} />}
      <div className="w-56 shrink-0">
        <div className="flex items-center gap-3">
          {item.photo ? (
            <img src={item.photo} alt="" width={40} height={40} referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-lighter">{item.name.slice(0, 1)}</span>
          )}
          <div className="min-w-0">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-gold">
                {item.name} <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <span className="font-semibold">{item.name}</span>
            )}
            {item.score !== null && <p className="text-xs text-gold">{labels.score.replace("{score}", String(item.score))}</p>}
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-xs text-slate-300">{item.headline}</p>
        <p className="text-xs text-slate-400">{[item.company, item.location].filter(Boolean).join(" · ")}</p>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">{item.kind === "message" ? labels.kindMessage : labels.kindInvitation}</p>
        {item.error && <p className="mt-1 text-xs text-red-300">{item.error}</p>}
      </div>
      <div className="flex-1 space-y-2">
        {editable ? (
          <textarea
            value={text}
            maxLength={max}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
            className={`${item.kind === "message" ? "min-h-[200px]" : "min-h-[110px]"} w-full rounded-lg bg-cream p-3 text-sm text-navy outline-none focus:ring-2 focus:ring-gold`}
          />
        ) : (
          <p className="whitespace-pre-line rounded-lg bg-cream p-3 text-sm text-navy">{text}</p>
        )}
        {editable && (
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xs ${chars > max ? "text-red-300" : "text-slate-400"}`}>{chars}/{max}</span>
            <div className="flex gap-2">
              {text !== item.message && !saved && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saving || chars < 10}
                  onClick={() =>
                    start(async () => {
                      const r = await updateQueuedMessage(item.id, text);
                      if (!r.error) setSaved(true);
                    })
                  }
                >
                  {labels.save}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || saving}
                onClick={() =>
                  start(async () => {
                    await regenerateMessages([item.id]);
                  })
                }
                title={labels.regenerate}
              >
                <RefreshCw className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} /> {labels.regenerate}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel} title={labels.cancel}>
                <X className="h-4 w-4" /> {labels.cancel}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
