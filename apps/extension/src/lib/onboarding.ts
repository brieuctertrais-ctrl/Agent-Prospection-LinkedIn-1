/**
 * Automatic onboarding: reads the user's OWN LinkedIn profile and their company's "About" page
 * in the given tab, then asks the server for a suggested persona (reviewed before saving).
 */
import { INDUSTRIES } from "@kairo/shared";
import { ApiError, logAction, suggestPersona } from "./api";
import { navigate, sendToTab } from "./tabs";
import { sleep } from "../linkedin/dom";

export type OnboardingResult = { ok: true } | { ok: false; code: string };

export async function runOnboarding(tabId: number): Promise<OnboardingResult> {
  // 1. Own profile (LinkedIn redirects /in/me/ to the user's profile).
  await navigate(tabId, "https://www.linkedin.com/in/me/");
  await sleep(2500);
  const prof = await sendToTab(tabId, { type: "SCRAPE_PROFILE" });
  if (!prof.ok || prof.type !== "PROFILE") return { ok: false, code: prof.ok ? "unknown" : prof.code };

  // 2. Company "About" page, when the current company is linked on the profile.
  let company: { url?: string; name: string; text: string } = { name: prof.profile.company, text: "" };
  const link = await sendToTab(tabId, { type: "FIND_COMPANY_URL" });
  if (link.ok && link.type === "COMPANY_URL" && link.url) {
    await navigate(tabId, `${link.url}about/`);
    await sleep(2500);
    const c = await sendToTab(tabId, { type: "SCRAPE_COMPANY" });
    if (c.ok && c.type === "COMPANY") company = { url: link.url, name: c.name || company.name, text: c.text };
  }

  // 3. Suggestion (AI, server side). Nothing is saved as a persona here.
  try {
    await suggestPersona({ profile: prof.profile, company, industries: INDUSTRIES.map((i) => i.label) });
    await logAction("onboarding", "success", { company_page: Boolean(company.url) });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e instanceof ApiError ? e.message : "generic" };
  }
}
