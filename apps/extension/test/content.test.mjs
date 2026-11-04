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
  assert.deepEqual(res, { ok: true });
  assert.equal(await page.evaluate(() => window.__note), note);
  await browser.close();
});
