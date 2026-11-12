"use client";
import { useState } from "react";
import { Copy, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface HealthLine {
  code: string;
  label: string;
  count: number;
}

/**
 * "Health" of the LinkedIn automation over the last 7 days: failures grouped by cause, and a
 * one-click copy of the structural diagnostic report (no names, no profile URLs, no message text).
 */
export function HealthCard({
  lines,
  report,
  labels,
}: {
  lines: HealthLine[];
  report: string;
  labels: { title: string; ok: string; issues: string; copy: string; copied: string; help: string };
}) {
  const [copied, setCopied] = useState(false);
  const total = lines.reduce((n, l) => n + l.count, 0);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <HeartPulse className={`h-5 w-5 ${total ? "text-amber-300" : "text-emerald-400"}`} /> {labels.title}
        </p>
        {total > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(report);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy className="h-4 w-4" /> {copied ? labels.copied : labels.copy}
          </Button>
        )}
      </div>
      {total === 0 ? (
        <p className="text-sm text-slate-300">{labels.ok}</p>
      ) : (
        <>
          <p className="text-sm text-slate-300">{labels.issues}</p>
          <ul className="space-y-1 text-sm">
            {lines.map((l) => (
              <li key={l.code} className="flex justify-between gap-3 border-b border-white/5 pb-1">
                <span className="text-slate-200">{l.label}</span>
                <span className="text-slate-400">{l.count}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">{labels.help}</p>
        </>
      )}
    </Card>
  );
}
