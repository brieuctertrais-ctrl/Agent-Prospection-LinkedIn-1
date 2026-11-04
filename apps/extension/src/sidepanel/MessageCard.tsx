import { useState } from "react";
import { Copy, Check, Pencil, RefreshCw, Send } from "lucide-react";
import { INVITATION_MAX_CHARS } from "@kairo/shared";
import { GoldButton } from "./components";

export function MessageCard({
  text,
  onChange,
  onRegenerate,
  onSend,
  busy,
  sendState,
  t,
}: {
  text: string;
  onChange: (t: string) => void;
  onRegenerate: () => void;
  onSend: () => void;
  busy: boolean;
  sendState: "idle" | "sending" | "sent" | "failed";
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const chars = [...text].length;
  const tooLong = chars > INVITATION_MAX_CHARS;

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bubble-in rounded-2xl bg-cream p-4 text-navy shadow">
      <div className="mb-2 flex justify-end gap-1">
        <IconBtn label={copied ? t("panel.copied") : t("panel.copy")} onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </IconBtn>
        <IconBtn label={t("panel.regenerate")} onClick={onRegenerate} disabled={busy || sendState === "sent"}>
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </IconBtn>
        <IconBtn label={t("panel.edit")} onClick={() => setEditing((e) => !e)} disabled={sendState === "sent"} active={editing}>
          <Pencil className="h-4 w-4" />
        </IconBtn>
      </div>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[140px] w-full resize-y rounded-lg border border-navy/20 bg-white/70 p-2 text-sm outline-none focus:border-gold-dark"
          autoFocus
        />
      ) : (
        <p className="whitespace-pre-line text-sm leading-relaxed">{text}</p>
      )}
      <p className={`mt-2 text-right text-xs ${tooLong ? "font-semibold text-red-600" : "text-navy/60"}`}>
        {tooLong ? t("panel.tooLong") : t("panel.chars", { count: chars })}
      </p>
      {sendState !== "sent" && (
        <GoldButton className="mt-3 w-full" onClick={onSend} disabled={busy || tooLong || sendState === "sending"}>
          <Send className="h-4 w-4" />
          {sendState === "sending" ? t("panel.sending") : t("panel.send")}
        </GoldButton>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      className={`rounded-lg p-1.5 transition hover:bg-navy/10 disabled:opacity-40 ${active ? "bg-navy/10" : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}
