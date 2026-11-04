"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { sendToExtension } from "@/lib/extension";

export function ConnectExtension({ labels }: { labels: { connect: string; ok: string; ko: string } }) {
  const [state, setState] = useState<"idle" | "working" | "ok" | "ko">("idle");

  async function connect() {
    setState("working");
    try {
      const res = await fetch("/api/extension/token", { method: "POST" });
      if (!res.ok) throw new Error("token");
      const { email, token_hash } = await res.json();
      const r = await sendToExtension<{ ok: boolean }>({ type: "AUTH_TOKEN", email, token_hash });
      setState(r?.ok ? "ok" : "ko");
    } catch {
      setState("ko");
    }
  }

  useEffect(() => {
    void connect();
  }, []);

  if (state === "ok") return <p className="rounded-lg bg-cream p-4 text-navy">{labels.ok}</p>;
  return (
    <div className="space-y-3">
      {state === "ko" && <p className="text-sm text-red-300">{labels.ko}</p>}
      <Button onClick={connect} disabled={state === "working"} className="w-full">{labels.connect}</Button>
    </div>
  );
}
