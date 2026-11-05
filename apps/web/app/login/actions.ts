"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const Schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  captchaToken: z.string().max(4096).optional(),
  next: z.string().max(200),
});

export type MagicLinkResult = { ok: true } | { ok: false; error: "invalid_request" | "rate_limited" | "send_failed" };

/**
 * Sends the magic link from the server: the client only gets a generic result,
 * the exact Supabase error is written to the server log (terminal / hosting logs).
 */
export async function requestMagicLink(input: { email: string; captchaToken?: string; next: string }): Promise<MagicLinkResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_request" };
  const { email, captchaToken } = parsed.data;
  const next = parsed.data.next.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/personas";

  const ip = await clientIp();
  if (!(await rateLimit(`ip:${ip}:magic-link`, 10, 3600))) {
    console.warn(JSON.stringify({ where: "login", reason: "ip_rate_limited" }));
    return { ok: false, error: "rate_limited" };
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      captchaToken,
    },
  });
  if (error) {
    // Server-side log only: error code + Supabase message (no email, no token, no key).
    console.error(JSON.stringify({ where: "login", status: error.status, code: error.code, message: error.message }));
    return { ok: false, error: error.status === 429 ? "rate_limited" : "send_failed" };
  }
  return { ok: true };
}
