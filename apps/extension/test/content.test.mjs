// DOM test of the scraper + invitation flow against a local fixture.
// Run: npm run test -w @kairo/extension
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

// Uses the Playwright install available in the environment (or `npm i -D playwright`).
const { chromium } = createRequire(import.meta.url)("playwright");

const bundle = await build({
  entryPoints: [new URL("./harness.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "iife", platform: "browser",
});
const code = bundle.outputFiles[0].text;
const html = readFileSync(new URL("./profile.html", import.meta.url), "utf8");

test("scrape profile and send invitation on fixture", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
  const page = await browser.newPage();
  await page.route("**/*", (r) => r.abort()); // no network: only the fixture is served
  await page.route("https://www.linkedin.com/in/sami-benali/", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await page.goto("https://www.linkedin.com/in/sami-benali/", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: code });

  const profile = await page.evaluate(() => window.kairo.scrapeProfile());
  assert.equal(profile.full_name, "Sami Benali");
  assert.equal(profile.first_name, "Sami");
  assert.equal(profile.company, "CashNow");
  assert.match(profile.headline, /CashNow/);
  assert.match(profile.about, /affacturage/);
  assert.equal(profile.experiences.length, 2);
  assert.equal(profile.experiences[0].company, "CashNow");
  assert.equal(profile.connection_state, "none");

  const note = "Bonjour Sami, test ?";
  const res = await page.evaluate((n) => window.kairo.sendInvitation(n), note);
  assert.equal(res.ok, true);
  assert.equal(await page.evaluate(() => window.__note), note);
  } finally {
    await browser.close();
  }
});

test("newer LinkedIn layout: title/heuristic fallbacks and never clicks another profile's button", { timeout: 60000 }, async () => {
  const fixture = readFileSync(new URL("./profile-new-ui.html", import.meta.url), "utf8");
  const browser = await chromium.launch();
  try {
  const page = await browser.newPage();
  await page.route("**/*", (r) => r.abort());
  await page.route("https://www.linkedin.com/in/francois-mathon/", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: fixture }));
  await page.goto("https://www.linkedin.com/in/francois-mathon/", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: code });

  const profile = await page.evaluate(() => window.kairo.scrapeProfile());
  assert.equal(profile.full_name, "François MATHON");
  assert.equal(profile.first_name, "François");
  assert.equal(profile.headline, "DIRECTEUR ADMINISTRATIF ET FINANCIER");
  assert.equal(profile.location, "Lille, Hauts-de-France, France");
  assert.equal(profile.connection_state, "none");
  assert.equal(profile.photo_url, "https://media.licdn.com/dms/image/abc.jpg");

  // Variant: company only in the headline, location without comma, long experience text.
  const variant = await page.evaluate(() => {
    document.querySelector(".u8i9").textContent = "Directeur administratif et financier chez Saint-Gobain - Groupe";
    document.querySelector(".o0p1 span").textContent = "Brest et périphérie";
    return window.kairo.scrapeProfile();
  });
  assert.equal(variant.company, "Saint-Gobain");
  assert.equal(variant.location, "Brest et périphérie");
  await page.evaluate(() => {
    document.querySelector(".u8i9").textContent = "DIRECTEUR ADMINISTRATIF ET FINANCIER";
    document.querySelector(".o0p1 span").textContent = "Lille, Hauts-de-France, France";
  });

  // Free LinkedIn account: 200-char limit → refuse without sending, modal left open.
  const tooLong = await page.evaluate((n) => window.kairo.sendInvitation(n), "Bonjour Monsieur Mathon, " + "a".repeat(250));
  assert.deepEqual(tooLong, { ok: false, code: "note_too_long", detail: "200" });
  assert.equal(await page.evaluate(() => window.__note), undefined);

  // Retry with a short note: the already-open modal is reused (no second click on Connect).
  const note = "Bonjour Monsieur Mathon, test ?";
  const res = await page.evaluate((n) => window.kairo.sendInvitation(n), note);
  assert.deepEqual(res, { ok: true, noteLimit: 200 }); // limit read from LinkedIn's modal
  assert.equal(await page.evaluate(() => window.__note), note);
  assert.equal(await page.evaluate(() => window.__wrongClicked ?? false), false);
  assert.equal(await page.evaluate(() => window.__sentWithoutNote ?? false), false);
  } finally {
    await browser.close();
  }
});

test("follow-up message: sent to a 1st-degree connection, never to a 2nd-degree one", { timeout: 60000 }, async () => {
  const first = readFileSync(new URL("./profile-1st.html", import.meta.url), "utf8");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (r) => r.abort());
    await page.route("https://www.linkedin.com/in/vincent-besson/", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: first }));
    await page.goto("https://www.linkedin.com/in/vincent-besson/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: code });
    const text = "Bonjour Monsieur Besson, merci pour la mise en relation. Un échange de 10 minutes ?";
    const res = await page.evaluate((t) => window.kairo.sendMessage(t), text);
    assert.deepEqual(res, { ok: true });
    assert.equal((await page.evaluate(() => window.__sent)).trim(), text);

    // Same page as a 2nd-degree profile: must refuse (no InMail) and click nothing.
    await page.evaluate(() => {
      document.querySelector("section span").textContent = " · 2e";
      window.__sent = undefined;
    });
    const refused = await page.evaluate((t) => window.kairo.sendMessage(t), text);
    assert.deepEqual(refused, { ok: false, code: "not_connected" });
    assert.equal(await page.evaluate(() => window.__sent), undefined);
  } finally {
    await browser.close();
  }
});

test("connections page: lazy-loaded list in an inner scroll container is read up to ~40", { timeout: 60000 }, async () => {
  const html = readFileSync(new URL("./connections.html", import.meta.url), "utf8");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (r) => r.abort());
    await page.route("https://www.linkedin.com/mynetwork/invite-connect/connections/", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
    await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: code });
    const urls = await page.evaluate(() => window.kairo.scrapeConnections());
    assert.ok(urls.length >= 40, `read ${urls.length}`);
    assert.ok(!urls.includes("https://www.linkedin.com/in/me/"), "navigation link ignored");
  } finally {
    await browser.close();
  }
});

test("inbox: who wrote last; a reminder is never sent over a reply", { timeout: 60000 }, async () => {
  const inbox = readFileSync(new URL("./inbox.html", import.meta.url), "utf8");
  const first = readFileSync(new URL("./profile-1st.html", import.meta.url), "utf8");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (r) => r.abort());
    await page.route("https://www.linkedin.com/messaging/", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: inbox }));
    await page.goto("https://www.linkedin.com/messaging/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: code });
    const convs = await page.evaluate(() => window.kairo.scrapeInbox());
    assert.deepEqual(convs, [
      { name: "Vincent BESSON", fromMe: false },
      { name: "Mathilde MARTELLY SEVENET", fromMe: true },
    ]);

    // Conversation whose last message comes from the prospect → refuse to send.
    const withReply = first.replace(
      "shadow.innerHTML = '<form",
      "shadow.innerHTML = '<ul><li class=\"msg-s-message-list__event\"><div class=\"msg-s-event-listitem\">Moi</div></li><li class=\"msg-s-message-list__event\"><div class=\"msg-s-event-listitem msg-s-event-listitem--other\">Oui, appelez-moi</div></li></ul><form",
    );
    const p2 = await browser.newPage();
    await p2.route("**/*", (r) => r.abort());
    await p2.route("https://www.linkedin.com/in/vincent-besson/", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: withReply }));
    await p2.goto("https://www.linkedin.com/in/vincent-besson/", { waitUntil: "domcontentloaded" });
    await p2.addScriptTag({ content: code });
    const res = await p2.evaluate(() => window.kairo.sendMessage("Bonjour Monsieur Besson, petite relance ?"));
    assert.deepEqual(res, { ok: false, code: "replied" });
    assert.equal(await p2.evaluate(() => window.__sent), undefined);
  } finally {
    await browser.close();
  }
});

test("onboarding: current company link on a profile and company 'About' page", { timeout: 60000 }, async () => {
  const profile = readFileSync(new URL("./profile-1st.html", import.meta.url), "utf8");
  const company = readFileSync(new URL("./company.html", import.meta.url), "utf8");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (r) => r.abort());
    await page.route("https://www.linkedin.com/in/vincent-besson/", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: profile }));
    await page.route("https://www.linkedin.com/company/efi/about/", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: company }));
    await page.goto("https://www.linkedin.com/in/vincent-besson/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: code });
    assert.equal(await page.evaluate(() => window.kairo.findCompanyUrl()), "https://www.linkedin.com/company/andre-renault/");

    await page.goto("https://www.linkedin.com/company/efi/about/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: code });
    const c = await page.evaluate(() => window.kairo.scrapeCompany());
    assert.equal(c.name, "EFI Énergies");
    assert.match(c.text, /mettant en concurrence les fournisseurs/);
    assert.match(c.text, /11-50 employés/);
    assert.doesNotMatch(c.text, /^Suivre$/m);
  } finally {
    await browser.close();
  }
});

test("unreadable pages are explained: deleted profile, logged out — a normal profile is never flagged", { timeout: 60000 }, async () => {
  const pages = {
    "https://www.linkedin.com/in/ancien-profil/": readFileSync(new URL("./profile-unavailable.html", import.meta.url), "utf8"),
    "https://www.linkedin.com/authwall?trk=x": readFileSync(new URL("./login.html", import.meta.url), "utf8"),
    "https://www.linkedin.com/in/sami-benali/": html,
  };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (r) => {
      const body = pages[r.request().url()];
      return body ? r.fulfill({ contentType: "text/html; charset=utf-8", body }) : r.abort();
    });
    const check = async (url) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: code });
      return page.evaluate(() => ({ problem: window.kairo.pageProblem(), profile: window.kairo.scrapeProfile(), diag: JSON.parse(window.kairo.diagnose()) }));
    };
    const gone = await check("https://www.linkedin.com/in/ancien-profil/");
    assert.equal(gone.profile, null);
    assert.equal(gone.problem, "profile_unavailable");
    assert.equal(gone.diag.page, "profile");

    const login = await check("https://www.linkedin.com/authwall?trk=x");
    assert.equal(login.problem, "logged_out");
    assert.equal(login.diag.page, "login");

    const ok = await check("https://www.linkedin.com/in/sami-benali/");
    assert.equal(ok.problem, null);
    assert.equal(ok.profile.full_name, "Sami Benali");
    // The diagnostic is structural only: no name, no URL.
    assert.doesNotMatch(JSON.stringify(ok.diag), /sami|benali|linkedin\.com/i);
  } finally {
    await browser.close();
  }
});
