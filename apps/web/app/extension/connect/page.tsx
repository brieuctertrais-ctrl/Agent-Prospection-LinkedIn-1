import { requireUser } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { ConnectExtension } from "./connect";

export default async function ConnectPage() {
  await requireUser();
  const { t } = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-navy-light p-8 text-center">
        <div className="flex justify-center"><Logo /></div>
        <ConnectExtension labels={{ connect: t("ext.connect"), ok: t("ext.connected"), ko: t("ext.notInstalled") }} />
      </div>
    </main>
  );
}
