import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Mints a one-time magic-link token for the SIGNED-IN user only (identity from the
 * session cookie, never from the request). The extension exchanges it with
 * `verifyOtp` to obtain its own session. Same-origin + rate limited.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ip = await clientIp();
  if (!(await rateLimit(`user:${data.user.id}:ext-token`, 5, 600)) || !(await rateLimit(`ip:${ip}:ext-token`, 20, 600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Service role used solely to generate a link for the authenticated user's own email.
  const { data: link, error } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: data.user.email });
  if (error || !link.properties?.hashed_token) {
    console.error(JSON.stringify({ where: "ext-token", code: error?.code ?? "no_token" }));
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json(
    { email: data.user.email, token_hash: link.properties.hashed_token },
    { headers: { "Cache-Control": "no-store" } },
  );
}
