import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { translate, type Locale, type MessageKey, type Mode, type Persona, type ScrapedProfile } from "@kairo/shared";
import { supabase } from "../lib/supabase";
import { getState, patchState } from "../lib/storage";
import { getLinkedInTab, sendToTab } from "../lib/tabs";
import { nextProfile, type Settings } from "../lib/engine";
import { ApiError, countToday, countWeek, generateMessage, logAction, markInvitationSent, rejectProfile, saveEditedMessage } from "../lib/api";
import { WEB_APP_URL } from "../lib/config";
import { Bubble, Conversation, GhostButton, GoldButton, Header, Mascot } from "./components";
import { MessageCard } from "./MessageCard";
import { CopywritingPanel } from "./CopywritingPanel";

type Screen =
  | { name: "loading" }
  | { name: "login" }
  | { name: "noPersona" }
  | { name: "noTab" }
  | { name: "welcome" }
  | { name: "searching" }
  | { name: "profile"; profile: ScrapedProfile; prospectId?: string; score?: number; reason?: string }
  | { name: "writing"; profile: ScrapedProfile }
  | {
      name: "message";
      profile: ScrapedProfile;
      text: string;
      originalText: string;
      messageId: string;
      leadId: string;
      prospectId: string;
      sendState: "idle" | "sending" | "sent" | "failed";
      sendError?: string;
      regenerating?: boolean;
    }
  | { name: "empty" }
  | { name: "dailyCap" }
  | { name: "paused"; reason: string }
  | { name: "error"; error: string };

/** Maps any error to a user-facing message key: no raw technical detail is displayed. */
const errorKey = (e: unknown) => `err.${e instanceof ApiError ? e.message : "generic"}`;

const DEFAULT_SETTINGS: Settings = { daily_profile_views: 80, daily_invitations: 20, weekly_invitations: 100, min_match_score: 60 };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [showSettings, setShowSettings] = useState(false);
  const [locale, setLocale] = useState<Locale>("fr");
  const [firstName, setFirstName] = useState("");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string>();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<Mode>("copilot");
  const [notice, setNotice] = useState<string>();
  const busy = useRef(false);

  const t = useCallback(
    (k: string, v?: Record<string, string | number>) => translate(locale, k as MessageKey, v),
    [locale],
  );
  const persona = personas.find((p) => p.id === activePersonaId);

  const bootstrap = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setScreen({ name: "login" });
    const [profile, ps, us, local] = await Promise.all([
      supabase.from("profiles").select("first_name, locale").eq("id", auth.user.id).single(),
      supabase.from("personas").select("*").order("created_at"),
      supabase.from("user_settings").select("*").eq("user_id", auth.user.id).single(),
      getState(),
    ]);
    setLocale(profile.data?.locale === "en" ? "en" : "fr");
    setFirstName(profile.data?.first_name ?? "");
    const list = (ps.data ?? []) as Persona[];
    setPersonas(list);
    if (us.data) setSettings({ ...DEFAULT_SETTINGS, ...us.data });
    setMode(local.mode);
    const active = list.find((p) => p.id === local.activePersonaId)?.id ?? us.data?.active_persona_id ?? list[0]?.id;
    setActivePersonaId(active);
    if (!list.length) return setScreen({ name: "noPersona" });
    if (local.pausedReason) return setScreen({ name: "paused", reason: local.pausedReason });
    setScreen({ name: "welcome" });
  }, []);

  useEffect(() => {
    void bootstrap();
    const listener = (msg: { type?: string }) => {
      if (msg?.type === "AUTH_CHANGED" || msg?.type === "PERSONA_CHANGED") void bootstrap();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [bootstrap]);

  const changePersona = async (id: string) => {
    setActivePersonaId(id);
    await patchState({ activePersonaId: id });
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) await supabase.from("user_settings").update({ active_persona_id: id }).eq("user_id", auth.user.id);
    setScreen({ name: "welcome" });
  };

  const changeMode = async (m: Mode) => {
    if (m === "autopilot") {
      // Phase 2: autopilot campaigns. Show the ToS warning and stay in copilot for now.
      setNotice(`${t("panel.autopilotWarning")} ${t("panel.autopilotSoon")}`);
      return;
    }
    setMode(m);
    await patchState({ mode: m });
  };

  const explore = async () => {
    if (!persona || busy.current) return;
    busy.current = true;
    setNotice(undefined);
    try {
      const tab = await getLinkedInTab();
      if (!tab?.id) return setScreen({ name: "noTab" });
      setScreen({ name: "searching" });
      const r = await nextProfile(tab.id, persona, settings);
      if (r.kind === "profile") setScreen({ name: "profile", ...r });
      else if (r.kind === "empty") setScreen({ name: "empty" });
      else if (r.kind === "daily_cap") setScreen({ name: "dailyCap" });
      else setScreen({ name: "paused", reason: r.code });
    } catch (e) {
      setScreen({ name: "error", error: errorKey(e) });
    } finally {
      busy.current = false;
    }
  };

  const reject = async () => {
    if (screen.name !== "profile" || !persona) return;
    try {
      await rejectProfile(persona.id, screen.profile, screen.prospectId);
    } catch (e) {
      return setScreen({ name: "error", error: errorKey(e) });
    }
    await explore();
  };

  const approve = async () => {
    if (screen.name !== "profile" || !persona) return;
    const profile = screen.profile;
    setScreen({ name: "writing", profile });
    try {
      const r = await generateMessage(persona.id, profile);
      setScreen({
        name: "message",
        profile,
        text: r.text,
        originalText: r.text,
        messageId: r.message_id,
        leadId: r.lead_id,
        prospectId: r.prospect_id,
        sendState: "idle",
      });
    } catch (e) {
      setScreen({ name: "error", error: errorKey(e) });
    }
  };

  const regenerate = async () => {
    if (screen.name !== "message" || !persona) return;
    const current = screen;
    setScreen({ ...current, regenerating: true });
    try {
      const r = await generateMessage(persona.id, current.profile, current.text);
      setScreen({ ...current, text: r.text, originalText: r.text, messageId: r.message_id, regenerating: false });
    } catch (e) {
      setScreen({ ...current, regenerating: false, sendError: t(errorKey(e)) });
    }
  };

  const send = async () => {
    if (screen.name !== "message") return;
    const current = screen;
    setScreen({ ...current, sendState: "sending", sendError: undefined });

    if (current.text !== current.originalText) await saveEditedMessage(current.messageId, current.text);

    const [day, week] = await Promise.all([countToday("invitation"), countWeek("invitation")]);
    if (day >= settings.daily_invitations || week >= settings.weekly_invitations) {
      return setScreen({ ...current, sendState: "failed", sendError: t("send.quota_reached") });
    }

    const tab = await getLinkedInTab();
    if (!tab?.id) return setScreen({ ...current, sendState: "failed", sendError: t("panel.openLinkedIn") });
    const res = await sendToTab(tab.id, { type: "SEND_INVITATION", note: current.text });

    if (res.ok) {
      await markInvitationSent(current.leadId, current.prospectId, current.profile.linkedin_url);
      return setScreen({ ...current, sendState: "sent" });
    }
    await logAction("invitation", "failure", { code: res.code, detail: res.detail }, { prospect_id: current.prospectId, linkedin_url: current.profile.linkedin_url });
    const reason = t(`send.${res.code}`) || res.code;
    if (res.code === "security_check" || res.code === "limit_reached" || res.code === "ui_changed") {
      await patchState({ pausedReason: res.code });
    }
    setScreen({ ...current, sendState: "failed", sendError: reason });
  };

  const resume = async () => {
    await patchState({ pausedReason: undefined });
    setScreen({ name: "welcome" });
  };

  const showControls = !["loading", "login", "noPersona"].includes(screen.name);

  return (
    <div className="flex min-h-full flex-col">
      <Header
        personas={personas}
        activePersonaId={activePersonaId}
        onPersona={changePersona}
        onSettings={() => setShowSettings((s) => !s)}
        mode={mode}
        onMode={changeMode}
        labels={{ copilot: t("panel.copilot"), autopilot: t("panel.autopilot") }}
        showControls={showControls}
      />
      <main className="flex-1 space-y-4 p-4">
        {notice && (
          <div className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-xs text-gold">
            {notice}
            <button className="ml-2 underline" onClick={() => setNotice(undefined)}>OK</button>
          </div>
        )}

        {showSettings && activePersonaId ? (
          <CopywritingPanel personaId={activePersonaId} onClose={() => setShowSettings(false)} t={t} />
        ) : (
          <ScreenView
            screen={screen}
            t={t}
            firstName={firstName}
            onExplore={explore}
            onApprove={approve}
            onReject={reject}
            onRegenerate={regenerate}
            onSend={send}
            onEdit={(text) => screen.name === "message" && setScreen({ ...screen, text })}
            onResume={resume}
            onRetry={bootstrap}
          />
        )}
      </main>
    </div>
  );
}

function ScreenView({
  screen,
  t,
  firstName,
  onExplore,
  onApprove,
  onReject,
  onRegenerate,
  onSend,
  onEdit,
  onResume,
  onRetry,
}: {
  screen: Screen;
  t: (k: string, v?: Record<string, string | number>) => string;
  firstName: string;
  onExplore: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  onSend: () => void;
  onEdit: (t: string) => void;
  onResume: () => void;
  onRetry: () => void;
}) {
  const next = (
    <GoldButton className="w-full" onClick={onExplore}>
      {t("panel.next")} <ArrowRight className="h-4 w-4" />
    </GoldButton>
  );

  switch (screen.name) {
    case "loading":
      return <EmptyState><Bubble>{t("common.loading")}</Bubble></EmptyState>;

    case "login":
      return (
        <EmptyState>
          <Bubble>{t("panel.login")}</Bubble>
          <GoldButton className="w-full" onClick={() => chrome.tabs.create({ url: `${WEB_APP_URL}/extension/connect` })}>
            {t("panel.loginBtn")}
          </GoldButton>
        </EmptyState>
      );

    case "noPersona":
      return (
        <EmptyState>
          <Bubble>{t("panel.noPersona")}</Bubble>
          <GoldButton className="w-full" onClick={() => chrome.tabs.create({ url: `${WEB_APP_URL}/personas/new` })}>
            {t("personas.new")}
          </GoldButton>
          <GhostButton className="w-full" onClick={onRetry}>↻</GhostButton>
        </EmptyState>
      );

    case "noTab":
      return (
        <EmptyState>
          <Bubble>{t("panel.openLinkedIn")}</Bubble>
          <GoldButton className="w-full" onClick={() => chrome.tabs.create({ url: "https://www.linkedin.com/feed/" })}>LinkedIn ↗</GoldButton>
        </EmptyState>
      );

    case "welcome":
      return (
        <>
          <Conversation>
            <Bubble>{t("panel.greeting", { firstName })}</Bubble>
            <Bubble delay={250}>{t("panel.found")}</Bubble>
            <Bubble delay={500}>{t("panel.letsGo")}</Bubble>
          </Conversation>
          <GoldButton className="w-full" onClick={onExplore}>
            {t("panel.explore")} <ArrowRight className="h-4 w-4" />
          </GoldButton>
        </>
      );

    case "searching":
      return <Conversation><Bubble>{t("panel.searching")}</Bubble></Conversation>;

    case "profile":
      return (
        <>
          <Conversation>
            <Bubble>{t("panel.hereIsProfile")}</Bubble>
            <ProfileSummary profile={screen.profile} score={screen.score} reason={screen.reason} />
            <Bubble delay={200}>{t("panel.interested")}</Bubble>
          </Conversation>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <GoldButton onClick={onApprove}><Check className="h-4 w-4" /> {t("panel.approve")}</GoldButton>
            <GhostButton onClick={onReject} aria-label="Passer" className="w-14"><X className="h-5 w-5" /></GhostButton>
          </div>
        </>
      );

    case "writing":
      return (
        <Conversation>
          <Bubble>{t("panel.noted")}</Bubble>
          <Bubble>{t("panel.writing")}</Bubble>
        </Conversation>
      );

    case "message":
      return (
        <>
          <Conversation>
            <Bubble>{t("panel.noted")}</Bubble>
            <Bubble delay={200}>{t("panel.suggest")}</Bubble>
          </Conversation>
          <MessageCard
            text={screen.text}
            onChange={onEdit}
            onRegenerate={onRegenerate}
            onSend={onSend}
            busy={Boolean(screen.regenerating)}
            sendState={screen.sendState}
            t={t}
          />
          {screen.sendState === "sent" && <Bubble>{t("panel.sent")}</Bubble>}
          {screen.sendState === "failed" && (
            <div className="space-y-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
              <p>❌ {screen.sendError}</p>
              <GhostButton className="w-full" onClick={() => navigator.clipboard.writeText(screen.text)}>
                {t("panel.copyManual")}
              </GhostButton>
            </div>
          )}
          {screen.sendError && screen.sendState !== "failed" && <p className="text-xs text-red-300">{screen.sendError}</p>}
          {next}
        </>
      );

    case "empty":
      return <EmptyState><Bubble>{t("panel.noMore")}</Bubble></EmptyState>;

    case "dailyCap":
      return <EmptyState><Bubble>{t("panel.dailyCap")}</Bubble></EmptyState>;

    case "paused":
      return (
        <EmptyState>
          <Bubble>{t("panel.paused", { reason: t(`send.${screen.reason}`) })}</Bubble>
          <GhostButton className="w-full" onClick={onResume}>{t("panel.resume")}</GhostButton>
        </EmptyState>
      );

    case "error":
      return (
        <EmptyState>
          <Bubble>{t(screen.error)}</Bubble>
          {next}
        </EmptyState>
      );
  }
}

function ProfileSummary({ profile, score, reason }: { profile: ScrapedProfile; score?: number; reason?: string }) {
  return (
    <div className="bubble-in flex gap-3 rounded-2xl bg-navy-light p-3">
      {profile.photo_url ? (
        <img src={profile.photo_url} alt="" className="h-12 w-12 rounded-full object-cover" />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-lighter font-bold">{profile.first_name.slice(0, 1)}</div>
      )}
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{profile.full_name}</p>
        <p className="line-clamp-2 text-slate-300">{profile.headline}</p>
        <p className="text-xs text-slate-400">{[profile.company, profile.location].filter(Boolean).join(" · ")}</p>
        {score !== undefined && (
          <p className="mt-1 text-xs text-gold" title={reason}>Match {score}%</p>
        )}
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 pt-8 text-center">
      <Mascot size={96} />
      <div className="flex w-full flex-col items-center gap-3">{children}</div>
    </div>
  );
}
