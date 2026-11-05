import type { ReactNode } from "react";
import { Settings, Search } from "lucide-react";
import { PRODUCT_NAME, PRODUCT_TAGLINE, type Mode } from "@kairo/shared";

export function Bubble({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <div className="bubble-in max-w-[92%] rounded-2xl rounded-tl-sm bg-cream px-4 py-3 text-sm leading-relaxed text-navy shadow" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function Mascot({ size = 40 }: { size?: number }) {
  return <img src="/mascot.svg" alt="" width={size} height={size} className="shrink-0 rounded-full" />;
}

export function Conversation({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <Mascot size={32} />
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}

export function GoldButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`flex h-11 items-center justify-center gap-2 rounded-xl bg-gold px-4 text-sm font-bold text-navy shadow transition hover:bg-gold-dark disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold text-slate-200 transition hover:bg-navy-light disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Header({
  personas,
  activePersonaId,
  onPersona,
  onSettings,
  mode,
  onMode,
  labels,
  showControls,
}: {
  personas: { id: string; name: string }[];
  activePersonaId?: string;
  onPersona: (id: string) => void;
  onSettings: () => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  labels: { copilot: string; autopilot: string };
  showControls: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 space-y-3 border-b border-white/5 bg-navy-dark/95 px-4 pb-3 pt-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Mascot size={34} />
          <span className="font-display text-2xl uppercase leading-none tracking-wide">
            {PRODUCT_NAME} <span className="text-gold">{PRODUCT_TAGLINE}</span>
          </span>
        </div>
        {showControls && (
          <button onClick={onSettings} aria-label="Settings" className="rounded-lg p-2 text-slate-300 hover:bg-navy-light hover:text-gold">
            <Settings className="h-5 w-5" />
          </button>
        )}
      </div>
      {showControls && (
        <>
          <div className="flex min-w-0 items-center gap-2 rounded-xl bg-navy-light px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <select
              value={activePersonaId ?? ""}
              onChange={(e) => onPersona(e.target.value)}
              className="h-10 min-w-0 flex-1 truncate bg-transparent text-sm font-medium outline-none"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id} className="bg-navy">{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 rounded-xl bg-navy-light p-1 text-xs font-semibold">
            {(["copilot", "autopilot"] as const).map((m) => (
              <button
                key={m}
                onClick={() => onMode(m)}
                className={`rounded-lg py-1.5 transition ${mode === m ? "bg-gold text-navy" : "text-slate-300"}`}
              >
                {labels[m]}
              </button>
            ))}
          </div>
        </>
      )}
    </header>
  );
}
