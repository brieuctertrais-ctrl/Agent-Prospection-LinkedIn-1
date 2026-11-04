import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Mints a one-time magic-link token for the signed-in user. The extension
 * exchanges it with `verifyOtp` to obtain its OWN session (separate refresh
 * token family), so web app and extension never fight over token rotation.
 */
export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: data.user.email });
  if (error || !link.properties?.hashed_token) {
    return NextResponse.json({ error: error?.message ?? "link_failed" }, { status: 500 });
  }
  return NextResponse.json({ email: data.user.email, token_hash: link.properties.hashed_token });
}
