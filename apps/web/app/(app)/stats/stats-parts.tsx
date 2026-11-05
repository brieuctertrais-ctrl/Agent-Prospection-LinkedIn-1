export function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl bg-navy-light p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-1 text-4xl font-bold tabular-nums text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/** Horizontal funnel: one series, one hue; values and step conversion as text (ink, not color). */
export function Funnel({
  title,
  help,
  stages,
  ofPrevious,
}: {
  title: string;
  help: string;
  stages: { label: string; value: number }[];
  ofPrevious: string;
}) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <section className="rounded-2xl bg-navy-light p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-5 text-sm text-slate-400">{help}</p>
      <ul className="space-y-3">
        {stages.map((st, i) => {
          const prev = i > 0 ? stages[i - 1].value : null;
          const conv = prev ? Math.round((st.value / prev) * 100) : null;
          const width = st.value === 0 ? 0 : Math.max(1, (st.value / max) * 100);
          return (
            <li key={st.label} className="grid grid-cols-[150px_1fr_auto] items-center gap-3" title={`${st.label} : ${st.value}`}>
              <span className="text-sm text-slate-300">{st.label}</span>
              <span className="relative h-5">
                <span
                  className="absolute inset-y-0 left-0 rounded-r"
                  style={{ width: `${width}%`, background: "var(--series-1)", minWidth: st.value ? 2 : 0 }}
                />
              </span>
              <span className="whitespace-nowrap text-right text-sm tabular-nums text-white">
                {st.value}
                {conv !== null && <span className="ml-2 text-xs text-slate-400">{ofPrevious.replace("{n}", String(conv))}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
