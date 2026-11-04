"use client";
import * as React from "react";
import { X } from "lucide-react";

/** Free-text chips with a max count (job titles, keywords). Serialises to hidden inputs. */
export function ChipsInput({
  name,
  defaultValue = [],
  max,
  placeholder,
  addLabel,
  prefix = "",
}: {
  name: string;
  defaultValue?: string[];
  max: number;
  placeholder?: string;
  addLabel: string;
  prefix?: string;
}) {
  const [values, setValues] = React.useState<string[]>(defaultValue);
  const [draft, setDraft] = React.useState("");

  const add = () => {
    const v = draft.trim().replace(/^#/, "");
    if (!v || values.length >= max || values.includes(v)) return;
    setValues([...values, v]);
    setDraft("");
  };

  return (
    <div className="rounded-lg border border-slate-600/50 bg-navy-dark p-2">
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-navy-lighter px-3 py-1 text-sm">
            {prefix}
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => setValues(values.filter((x) => x !== v))}>
              <X className="h-3.5 w-3.5 text-slate-400 hover:text-white" />
            </button>
            <input type="hidden" name={name} value={v} />
          </span>
        ))}
        {values.length < max && (
          <span className="inline-flex items-center gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder={placeholder}
              className="w-40 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-slate-500"
            />
            <button type="button" onClick={add} className="text-sm font-medium text-gold hover:underline">
              {addLabel}
            </button>
          </span>
        )}
      </div>
      <p className="mt-1 px-1 text-xs text-slate-500">
        {values.length}/{max}
      </p>
    </div>
  );
}
