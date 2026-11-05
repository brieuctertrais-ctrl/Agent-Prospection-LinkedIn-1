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
