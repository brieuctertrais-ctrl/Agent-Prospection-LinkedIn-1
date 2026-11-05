import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Pause, Play, RefreshCw, Sparkles } from "lucide-react";
import type { Persona } from "@kairo/shared";
import { batchCounts, inWorkingHours, prepareBatch, resumeCampaigns, type PrepareEnd } from "../lib/autopilot";
import { getAuto, onAutoChange, patchAuto, type AutoState } from "../lib/autostate";
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
  const [counts, setCounts] = useState({ toReview: 0, followups: 0, approved: 0 });
  const [size, setSize] = useState(10);
  const [running, setRunning] = useState<"idle" | "preparing" | "sending">("idle");
  const [status, setStatus] = useState<string>();
  const [accept, setAccept] = useState(false);
  const stop = useRef(false);
  const [auto, setAuto] = useState<AutoState | null>(null);

  const refresh = useCallback(async () => setCounts(await batchCounts()), []);
  useEffect(() => {
    void refresh();
    void getAuto().then(setAuto);
    return onAutoChange((a) => {
      setAuto(a);
      void refresh();
    });
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
      const stats = { prepared: 0, low: 0, connected: 0, last: undefined as number | undefined };
      const show = () =>
        setStatus(
          `${t("ap.preparing", { n: stats.prepared, size })} ${t("ap.stats", { low: stats.low, connected: stats.connected })}` +
            (stats.last !== undefined ? ` ${t("ap.lastScore", { score: stats.last, min: settings.min_match_score })}` : ""),
        );
      const r = await prepareBatch({
        tabId,
        persona: (await fetchPersona(persona.id)) ?? persona,
        settings,
        size,
        noteMax,
        onProgress: (n) => {
          stats.prepared = n;
          show();
        },
        onSkip: (e) => {
          if (e.reason === "low_score") {
            stats.low += 1;
            stats.last = e.score;
          } else if (e.reason === "connected") stats.connected += 1;
          show();
        },
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

  const toggleAuto = async (on: boolean) => {
    if (on) {
      await resumeCampaigns();
      await patchState({ pausedReason: undefined });
      await patchAuto({ enabled: true, nextAt: undefined, notified: undefined });
      await chrome.runtime.sendMessage({ type: "AUTOPILOT_TICK" }).catch(() => undefined);
    } else {
      await patchAuto({ enabled: false });
    }
  };

  const autoLine = (a: AutoState) => {
    const parts = [t("ap.auto.today", { sent: a.day === new Date().toISOString().slice(0, 10) ? a.sentToday : 0, failed: a.failedToday })];
    if (a.last) parts.push(t(`ap.auto.last.${a.last}`, { code: a.lastCode ? t(`send.${a.lastCode}`) : "" }));
    if (a.enabled && a.nextAt && a.nextAt > Date.now()) {
      parts.push(t("ap.auto.next", { time: new Date(a.nextAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) }));
    }
    if (a.day === new Date().toISOString().slice(0, 10) && (a.messagesToday ?? 0) > 0) parts.push(t("ap.auto.messages", { n: a.messagesToday ?? 0 }));
    if (a.lastAcceptCheck) {
      parts.push(
        t("ap.auto.lastCheck", {
          time: new Date(a.lastAcceptCheck).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
          accepted: a.lastAccepted ?? 0,
          found: a.lastFound ?? 0,
        }),
      );
    }
    if (a.enabled && !inWorkingHours(settings)) parts.push(t("ap.auto.outside", { start: settings.work_start_hour ?? 9, end: settings.work_end_hour ?? 19 }));
    return parts.join(" ");
  };

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
            {counts.followups > 0 && <p className="text-sm font-semibold text-gold">{t("ap.followups", { n: counts.followups })}</p>}
            <GhostButton className="w-full" onClick={() => chrome.tabs.create({ url: `${WEB_APP_URL}/autopilot` })}>
              {t("ap.openReview")} <ExternalLink className="h-4 w-4" />
            </GhostButton>
          </section>

          <section className="space-y-2 rounded-2xl bg-navy-light p-4">
            <p className="font-semibold">{t("ap.step3")}</p>
            <p className="text-sm text-slate-300">{t("ap.approved", { n: counts.approved })}</p>
            <p className="text-xs text-slate-400">
              {t("ap.autoHelp", {
                min: settings.min_delay_seconds ?? 45,
                max: settings.max_delay_seconds ?? 180,
                start: settings.work_start_hour ?? 9,
                end: settings.work_end_hour ?? 19,
              })}
            </p>
            {auto && (
              <div className={`rounded-xl p-3 text-xs ${auto.enabled ? "bg-emerald-500/10 text-emerald-200" : "bg-navy-dark text-slate-300"}`}>
                <p className="mb-1 font-semibold">{auto.enabled ? t("ap.auto.on") : t("ap.auto.off")}</p>
                <p>{autoLine(auto)}</p>
              </div>
            )}
            {auto?.enabled && (
              <>
                <GhostButton className="w-full" onClick={() => void chrome.runtime.sendMessage({ type: "CHECK_ACCEPTANCES" }).catch(() => undefined)}>
                  <RefreshCw className="h-4 w-4" /> {t("ap.checkAccept")}
                </GhostButton>
                <p className="text-center text-[11px] text-slate-500">{t("ap.checkAcceptHelp")}</p>
              </>
            )}
            {auto?.enabled ? (
              <GhostButton className="w-full" onClick={() => toggleAuto(false)}>
                <Pause className="h-4 w-4" /> {t("ap.auto.stop")}
              </GhostButton>
            ) : (
              <GoldButton className="w-full" onClick={() => toggleAuto(true)}>
                <Play className="h-4 w-4" /> {t("ap.auto.start")}
              </GoldButton>
            )}
          </section>

          <button onClick={() => void refresh()} className="mx-auto flex items-center gap-1 text-xs text-slate-400 hover:text-gold">
            <RefreshCw className="h-3 w-3" /> {t("ap.refresh")}
          </button>
        </>
      )}
    </div>
  );
}
