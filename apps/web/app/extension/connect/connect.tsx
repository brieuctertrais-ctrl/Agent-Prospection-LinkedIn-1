"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { sendToExtension } from "@/lib/extension";

type Failure = "tokenFailed" | "unreachable" | "refused" | "authFailed";

export function ConnectExtension({ labels }: { labels: { connect: string; ok: string } & Record<Failure, string> }) {
  const [state, setState] = useState<"idle" | "working" | "ok" | Failure>("idle");
  const started = useRef(false);

  async function connect() {
    setState("working");
    // 1. One-time token for the signed-in user (server route, rate limited).
    let token: { email: string; token_hash: string };
    try {
      const res = await fetch("/api/extension/token", { method: "POST" });
      if (!res.ok) return setState("tokenFailed");
      token = await res.json();
    } catch {
      return setState("tokenFailed");
    }
    // 2. Hand it to the extension, which opens its own session.
    let reply: { ok?: boolean; error?: string } | undefined;
    try {
      reply = await sendToExtension<{ ok?: boolean; error?: string }>({ type: "AUTH_TOKEN", ...token });
    } catch {
      return setState("unreachable");
    }
    if (reply?.ok) return setState("ok");
    setState(reply?.error === "invalid_request" ? "refused" : "authFailed");
  }

  useEffect(() => {
    if (started.current) return; // avoid a double call (React strict mode) that would burn the one-time token
    started.current = true;
    void connect();
  }, []);

  if (state === "ok") return <p className="rounded-lg bg-cream p-4 text-navy">{labels.ok}</p>;
  return (
    <div className="space-y-3">
      {state !== "idle" && state !== "working" && <p className="text-sm text-red-300">{labels[state]}</p>}
      <Button onClick={connect} disabled={state === "working"} className="w-full">{labels.connect}</Button>
    </div>
  );
}
