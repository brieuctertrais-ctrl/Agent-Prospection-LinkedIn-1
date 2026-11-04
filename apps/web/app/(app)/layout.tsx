import { PRODUCT_NAME } from "@kairo/shared";
import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { Sidebar } from "@/components/sidebar";
import { ProspectButton } from "@/components/prospect-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireUser();
  const { t } = await getT();
  const [{ data: profile }, { count }] = await Promise.all([
    supabase.from("profiles").select("first_name, full_name").eq("id", user.id).single(),
    supabase.from("leads").select("id", { count: "exact", head: true }).is("seen_at", null),
  ]);
  const name = profile?.full_name || profile?.first_name || user.email || "";

  return (
    <div className="flex min-h-screen">
      <Sidebar
        newLeads={count ?? 0}
        user={{ name, email: user.email ?? "" }}
        labels={{
          personas: t("nav.personas"),
          leads: t("nav.leads"),
          knowledge: t("nav.knowledge"),
          tuto: t("nav.tuto"),
          settings: t("nav.settings"),
          logout: t("nav.logout"),
          new: t("nav.new"),
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex justify-end px-8 pt-6">
          <ProspectButton label={t("cta.prospectWith", { name: PRODUCT_NAME })} />
        </header>
        <main className="flex-1 px-8 pb-12 pt-2">{children}</main>
      </div>
    </div>
  );
}
