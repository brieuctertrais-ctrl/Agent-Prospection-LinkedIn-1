import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchLeads } from "@/lib/leads";

const csvCell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // prevent CSV formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

/** CSV export (opens in Excel) — paid plans only. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: paid } = await supabase.rpc("is_paid");
  if (!paid) return NextResponse.json({ error: "payment_required" }, { status: 402 });

  const sp = request.nextUrl.searchParams;
  const leads = await fetchLeads(
    supabase,
    { persona: sp.get("persona") ?? undefined, status: sp.get("status") ?? undefined, q: sp.get("q") ?? undefined },
    10000,
  );
  const header = ["Nom", "Poste", "Entreprise", "Localisation", "URL LinkedIn", "Persona", "Message", "Date", "Statut"];
  const rows = leads.map((l) => [
    l.prospect.full_name, l.prospect.headline, l.prospect.company, l.prospect.location, l.prospect.linkedin_url,
    l.persona?.name, l.message?.text, l.created_at, l.status,
  ]);
  const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
