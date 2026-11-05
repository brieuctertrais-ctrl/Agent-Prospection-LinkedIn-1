import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Pause, RefreshCw, Send, Sparkles } from "lucide-react";
import type { Persona } from "@kairo/shared";
import { batchCounts, prepareBatch, sendApproved, type PrepareEnd, type SendEnd } from "../lib/autopilot";
import type { Settings } from "../lib/engine";
import { getLinkedInTab } from "../lib/tabs";
import { fetchPersona } from "../lib/api";
import { patchState } from "../lib/storage";
import { supabase } from "../lib/supabase";
import { WEB_APP_URL } from "../lib/config";
import { Bubble, Conversation, GhostButton, GoldButton } from "./components";

type T = (k: string, v?: Record<string, string | number>) => string;

export function AutopilotPanel({
  persona,
  settings,
  onSettings,
  noteMax,
  onNoteMax,
  t,
}: {
  persona: Persona;
  settings: Settings;
  onSettings: (s: Settings) => void;
  noteMax: number;
  onNoteMax: (n: number) => void;
  t: T;
}) {
  const [counts, setCounts] = useState({ toReview: 0, approved: 0 });
  const [size, setSize] = useState(10);
  const [running, setRunning] = useState<"idle" | "preparing" | "sending">("idle");
  const [status, setStatus] = useState<string>();
  const [accept, setAccept] = useState(false);
  const stop = useRef(false);

  const refresh = useCallback(async () => setCounts(await batchCounts()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!settings.autopilot_warning_accepted_at) {
    return (
      <div className="space-y-3 rounded-2xl border border-gold/40 bg-gold/10 p-4 text-sm">
        <p className="font-semibold text-gold">{t("ap.warningTitle")}</p>
        <p className="text-slate-200">{t("ap.warning")}</p>
        <label className="flex items-start gap-2 text-slate-200">
          <input type="checkbox" className="mt-1 accent-[#F5C451]" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          {t("ap.accept")}
        </label>
        <GoldButton
          className="w-full"
          disabled={!accept}
          onClick={async () => {
            const { data: auth } = await supabase.auth.getUser();
            if (!auth.user) return;
            const at = new Date().toISOString();
            await supabase.from("user_settings").update({ autopilot_warning_accepted_at: at }).eq("user_id", auth.user.id);
            onSettings({ ...settings, autopilot_warning_accepted_at: at });
          }}
        >
          {t("ap.activate")}
        </GoldButton>
      </div>
    );
  }

  const withTab = async (fn: (tabId: number) => Promise<void>) => {
    const tab = await getLinkedInTab();
    if (!tab?.id) return setStatus(t("panel.openLinkedIn"));
    stop.current = false;
    try {
      await fn(tab.id);
    } catch {
      setStatus(t("ap.end.error", { error: t("err.generic") }));
    } finally {
      setRunning("idle");
      void refresh();
    }
  };

  const prepare = () =>
    withTab(async (tabId) => {
      setRunning("preparing");
      setStatus(t("ap.preparing", { n: 0, size }));
      const r = await prepareBatch({
        tabId,
        persona: (await fetchPersona(persona.id)) ?? persona,
        settings,
        size,
        noteMax,
        onProgress: (n) => setStatus(t("ap.preparing", { n, size })),
        shouldStop: () => stop.current,
      });
      const key: Record<PrepareEnd, string> = {
        done: "ap.end.prepared",
        empty: "ap.end.empty",
        daily_cap: "ap.end.daily_cap",
        stopped: "ap.end.stopped",
        paused: "panel.paused",
        error: "ap.end.error",
        low_match: "ap.end.low_match",
      };
      setStatus(
        r.end === "paused"
          ? t("panel.paused", { reason: t(`send.${r.code}`) })
          : r.end === "error"
            ? t("ap.end.error", { error: t(`err.${r.code ?? "generic"}`) })
            : t(key[r.end], { n: r.prepared, low: r.lowScore ?? 0, min: settings.min_match_score }),
      );
    });

  const send = () =>
    withTab(async (tabId) => {
      setRunning("sending");
      setStatus(t("ap.sending", { sent: 0, failed: 0 }));
      const r = await sendApproved({
        tabId,
        settings,
        noteMax,
        shouldStop: () => stop.current,
        onProgress: (p) => {
          setStatus(t("ap.sending", { sent: p.sent, failed: p.failed }) + (p.waitSeconds ? ` ${t("ap.next", { s: p.waitSeconds })}` : ""));
          if (p.noteLimit) {
            onNoteMax(p.noteLimit);
            void patchState({ noteMaxChars: p.noteLimit });
          }
        },
      });
      const key: Record<SendEnd, string> = {
        done: "ap.end.done",
        outside_hours: "ap.end.outside_hours",
        quota: "ap.end.quota",
        paused: "panel.paused",
        paused_by_user: "ap.end.paused_by_user",
        stopped: "ap.end.stopped",
        error: "ap.end.error",
      };
      setStatus(
        r.end === "paused"
          ? t("panel.paused", { reason: t(`send.${r.code}`) })
          : r.end === "error"
            ? t("ap.end.error", { error: t("err.generic") })
            : t(key[r.end], { sent: r.sent, failed: r.failed }),
      );
    });

  const busy = running !== "idle";

  return (
    <div className="space-y-4">
      {status && (
        <Conversation>
          <Bubble>{status}</Bubble>
        </Conversation>
      )}

      {busy ? (
        <GhostButton className="w-full" onClick={() => (stop.current = true)}>
          <Pause className="h-4 w-4" /> {t("ap.stop")}
        </GhostButton>
      ) : (
        <>
          <section className="space-y-2 rounded-2xl bg-navy-light p-4">
            <p className="font-semibold">{t("ap.step1")}</p>
            <p className="text-xs text-slate-400">{t("ap.step1Help")}</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-300" htmlFor="ap-size">{t("ap.size")}</label>
              <select
                id="ap-size"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="h-9 rounded-lg bg-navy-dark px-2 text-sm"
              >
                {[10, 15, 20].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <GoldButton className="w-full" onClick={prepare}>
              <Sparkles className="h-4 w-4" /> {t("ap.prepare")}
            </GoldButton>
          </section>

          <section className="space-y-2 rounded-2xl bg-navy-light p-4">
            <p className="font-semibold">{t("ap.step2")}</p>
            <p className="text-sm text-slate-300">{t("ap.toReview", { n: counts.toReview })}</p>
            <GhostButton className="w-full" onClick={() => chrome.tabs.create({ url: `${WEB_APP_URL}/autopilot` })}>
              {t("ap.openReview")} <ExternalLink className="h-4 w-4" />
            </GhostButton>
          </section>

          <section className="space-y-2 rounded-2xl bg-navy-light p-4">
            <p className="font-semibold">{t("ap.step3")}</p>
            <p className="text-sm text-slate-300">{t("ap.approved", { n: counts.approved })}</p>
            <p className="text-xs text-slate-400">
              {t("ap.sendHelp", {
                min: settings.min_delay_seconds ?? 45,
                max: settings.max_delay_seconds ?? 180,
                start: settings.work_start_hour ?? 9,
                end: settings.work_end_hour ?? 19,
              })}
            </p>
            <GoldButton className="w-full" onClick={send} disabled={counts.approved === 0}>
              <Send className="h-4 w-4" /> {t("ap.send")}
            </GoldButton>
          </section>

          <button onClick={() => void refresh()} className="mx-auto flex items-center gap-1 text-xs text-slate-400 hover:text-gold">
            <RefreshCw className="h-3 w-3" /> {t("ap.refresh")}
          </button>
        </>
      )}
    </div>
  );
}
