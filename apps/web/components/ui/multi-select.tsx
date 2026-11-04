"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Toggle pills for a fixed option list, plus optional free entries. */
export function MultiSelect({
  name,
  options,
  defaultValue = [],
  allowCustom = false,
  addLabel = "+",
}: {
  name: string;
  options: string[];
  defaultValue?: string[];
  allowCustom?: boolean;
  addLabel?: string;
}) {
  const [selected, setSelected] = React.useState<string[]>(defaultValue);
  const [custom, setCustom] = React.useState("");
  const all = Array.from(new Set([...options, ...selected]));

  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));

  return (
    <div className="flex flex-wrap gap-2">
      {all.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
              on ? "border-gold bg-gold/15 text-gold" : "border-slate-600/50 text-slate-300 hover:border-slate-400",
            )}
          >
            {on && <Check className="h-3.5 w-3.5" />}
            {o}
          </button>
        );
      })}
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
      {allowCustom && (
        <span className="inline-flex items-center gap-1">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (custom.trim()) setSelected((s) => Array.from(new Set([...s, custom.trim()])));
                setCustom("");
              }
            }}
            className="w-32 rounded-full border border-dashed border-slate-600/50 bg-transparent px-3 py-1 text-sm outline-none"
            placeholder={addLabel}
          />
        </span>
      )}
    </div>
  );
}
