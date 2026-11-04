import { cookies } from "next/headers";
import { translate, type Locale, type MessageKey } from "@kairo/shared";

export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get("locale")?.value;
  return c === "en" ? "en" : "fr";
}

export async function getT() {
  const locale = await getLocale();
  return {
    locale,
    t: (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
  };
}
