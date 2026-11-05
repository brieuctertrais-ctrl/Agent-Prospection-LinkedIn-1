import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchLeads, LeadFiltersSchema } from "@/lib/leads";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const csvCell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // prevent CSV formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

/** CSV export (opens in Excel) — paid plans only, rate limited. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ip = await clientIp();
  if (!(await rateLimit(`user:${auth.user.id}:export`, 10, 3600)) || !(await rateLimit(`ip:${ip}:export`, 30, 3600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Entitlement comes from the subscription row (written only by the verified webhook).
  const { data: paid } = await supabase.rpc("is_paid");
  if (!paid) return NextResponse.json({ error: "payment_required" }, { status: 402 });

  const filters = LeadFiltersSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  let leads;
  try {
    leads = await fetchLeads(supabase, filters, 10000);
  } catch (e) {
    console.error(JSON.stringify({ where: "export", error: e instanceof Error ? e.message : "unknown" }));
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  const header = ["Nom", "Poste", "Entreprise", "Localisation", "URL LinkedIn", "Persona", "Message", "Date", "Statut"];
  const rows = leads.map((l) => [
    l.full_name, l.headline, l.company, l.location, l.linkedin_url, l.persona_name, l.message_text, l.created_at, l.status,
  ]);
  const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
