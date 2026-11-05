"use client";
import { useEffect, useRef, useState } from "react";

export interface Week {
  week: string; // YYYY-MM-DD (Monday)
  invited: number;
  accepted: number;
}

const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 32 };
const BAR = 16; // <= 24px thick, never fills the slot
const GAP = 2; // surface gap between the two touching bars

/** Grouped columns: invitations sent (series 1) and accepted (series 2) per week, with hover tooltip. */
export function WeeklyChart({
  weeks,
  locale,
  labels,
}: {
  weeks: Week[];
  locale: string;
  labels: { invited: string; accepted: string; weekOf: string; rate: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = Math.max(1, weeks.length);
  // Fill the card width; keep at least 48px per week (horizontal scroll on very small screens).
  const slot = Math.max(48, Math.floor((avail - PAD.left - PAD.right) / n));
  const W = PAD.left + PAD.right + n * slot;
  const max = Math.max(1, ...weeks.map((w) => w.invited));
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4; // even → whole-number mid tick
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / niceMax);
  const ticks = [0, niceMax / 2, niceMax];
  const fmt = (d: string) => new Date(d).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "2-digit" });

  return (
    <div className="relative">
      {/* Legend (2 series) */}
      <div className="mb-3 flex gap-5 text-sm text-slate-300">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ background: "var(--series-1)" }} /> {labels.invited}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ background: "var(--series-2)" }} /> {labels.accepted}
        </span>
      </div>
      <div ref={box} className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${labels.invited} / ${labels.accepted}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {v}
              </text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const cx = PAD.left + i * slot + slot / 2;
            const x1 = cx - BAR - GAP / 2;
            const x2 = cx + GAP / 2;
            const base = y(0);
            return (
              <g key={w.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* hit target larger than the marks */}
                <rect x={cx - slot / 2} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom} fill="transparent" />
                {hover === i && <rect x={cx - slot / 2 + 4} y={PAD.top} width={slot - 8} height={base - PAD.top} fill="var(--grid)" opacity={0.35} rx={4} />}
                <Column x={x1} top={y(w.invited)} base={base} color="var(--series-1)" />
                <Column x={x2} top={y(w.accepted)} base={base} color="var(--series-2)" />
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                  {fmt(w.week)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {hover !== null && weeks[hover] && (
        <div
          className="pointer-events-none absolute top-10 rounded-lg border border-white/10 bg-navy-dark px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(PAD.left + hover * slot + slot, W - 140) }}
        >
          <p className="mb-1 font-semibold text-white">
            {labels.weekOf} {fmt(weeks[hover].week)}
          </p>
          <p className="text-slate-300">
            {labels.invited} : <span className="tabular-nums text-white">{weeks[hover].invited}</span>
          </p>
          <p className="text-slate-300">
            {labels.accepted} : <span className="tabular-nums text-white">{weeks[hover].accepted}</span>
          </p>
          <p className="text-slate-300">
            {labels.rate} :{" "}
            <span className="tabular-nums text-white">
              {weeks[hover].invited ? `${Math.round((weeks[hover].accepted / weeks[hover].invited) * 100)} %` : "—"}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

/** Column with a 4px rounded data-end and a square baseline. */
function Column({ x, top, base, color }: { x: number; top: number; base: number; color: string }) {
  const h = Math.max(0, base - top);
  if (h <= 0) return null;
  const r = Math.min(4, h);
  const d = `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + BAR - r} Q${x + BAR},${top} ${x + BAR},${top + r} V${base} Z`;
  return <path d={d} fill={color} />;
}
