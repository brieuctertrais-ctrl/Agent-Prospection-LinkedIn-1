import { getT } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { t } = await getT();
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8 rounded-2xl bg-navy-light p-8 shadow-xl">
        <div className="flex flex-col items-center gap-4">
          <img src="/mascot.svg" alt="" className="h-20 w-20" />
          <Logo withAvatar={false} />
        </div>
        <h1 className="text-center text-xl font-semibold">{t("auth.title")}</h1>
        <LoginForm
          next={next ?? "/personas"}
          labels={{ email: t("auth.email"), send: t("auth.send"), sent: t("auth.sent"), error: t("auth.error"), captcha: t("auth.captcha"), rateLimited: t("err.rate_limited") }}
        />
      </div>
    </main>
  );
}
