import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Fixed-window rate limit backed by public.check_rate_limit(). The service role is
 * used ONLY to call this server-only counter, never to access user data.
 * Fails closed: if the check cannot run, the request is refused.
 */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("check_rate_limit", {
    p_key: key.slice(0, 200),
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error(JSON.stringify({ where: "rateLimit", code: error.code }));
    return false;
  }
  return data === true;
}
