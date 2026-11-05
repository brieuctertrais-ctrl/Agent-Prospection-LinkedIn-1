"use client";
import { useEffect, useRef, useState } from "react";
import { requestMagicLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
}

/** Cloudflare Turnstile widget (captcha). Verified server-side by Supabase Auth. */
function useTurnstile(container: React.RefObject<HTMLDivElement | null>) {
  const [token, setToken] = useState<string | null>(null);
  const widget = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !container.current) return;
    const render = () => {
      const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (!ts || !container.current || widget.current) return;
      widget.current = ts.render(container.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(null),
      });
    };
    if (!document.getElementById("cf-turnstile")) {
      const s = document.createElement("script");
      s.id = "cf-turnstile";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    } else render();
  }, [container]);
  const reset = () => {
    setToken(null);
    (window as unknown as { turnstile?: TurnstileApi }).turnstile?.reset(widget.current);
  };
  return { token, reset, enabled: Boolean(TURNSTILE_SITE_KEY) };
}

export function LoginForm({
  next,
  labels,
}: {
  next: string;
  labels: { email: string; send: string; sent: string; error: string; captcha: string; rateLimited: string };
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const captchaRef = useRef<HTMLDivElement>(null);
  const captcha = useTurnstile(captchaRef);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (captcha.enabled && !captcha.token) {
      setError(labels.captcha);
      return setState("error");
    }
    setState("sending");
    const res = await requestMagicLink({ email, captchaToken: captcha.token ?? undefined, next });
    captcha.reset();
    if (!res.ok) {
      setError(res.error === "rate_limited" ? labels.rateLimited : labels.error); // generic, details in server log
      setState("error");
    } else setState("sent");
  }

  if (state === "sent") return <p className="rounded-lg bg-cream p-4 text-center text-navy">{labels.sent}</p>;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">{labels.email}</Label>
        <Input id="email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {captcha.enabled && <div ref={captchaRef} className="flex justify-center" />}
      {state === "error" && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" className="w-full" disabled={state === "sending"}>
        {labels.send}
      </Button>
    </form>
  );
}
