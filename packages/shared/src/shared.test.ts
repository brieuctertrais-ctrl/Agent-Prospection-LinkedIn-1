import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPeopleSearchUrl, normalizeProfileUrl } from "./linkedin-search.ts";
import { checkInvitation } from "./invitation.ts";

test("buildPeopleSearchUrl maps titles, geo and industries", () => {
  const url = new URL(
    buildPeopleSearchUrl(
      { job_titles: ["SDR", "business developer"], locations: ["France", "Lyon"], industries: ["Software Development"] },
      2,
    ),
  );
  assert.equal(url.searchParams.get("keywords"), '(SDR OR "business developer") Lyon');
  assert.equal(url.searchParams.get("geoUrn"), '["105015875"]');
  assert.equal(url.searchParams.get("industry"), '["4"]');
  assert.equal(url.searchParams.get("page"), "2");
});

test("normalizeProfileUrl", () => {
  assert.equal(
    normalizeProfileUrl("https://www.linkedin.com/in/Jean-Dupont-123/?miniProfileUrn=x"),
    "https://www.linkedin.com/in/jean-dupont-123/",
  );
  assert.equal(normalizeProfileUrl("https://www.linkedin.com/company/acme"), null);
});

test("checkInvitation", () => {
  assert.ok(checkInvitation("Bonjour Monsieur Besson, un échange vous tente ?", "Vincent", "BESSON").ok);
  assert.ok(checkInvitation("Bonjour Madame de La Tour, un échange ?", "Anne", "DE LA TOUR").ok);
  assert.ok(checkInvitation("Bonjour Camille Durand, un échange ?", "Camille", "Durand").ok);
  const long = checkInvitation("Bonjour Monsieur Besson, " + "a".repeat(300), "Vincent", "Besson");
  assert.deepEqual(long.errors, ["too_long"]);
  assert.ok(checkInvitation("Bonjour Vincent, un échange ?", "Vincent", "Besson").errors.includes("bad_greeting"));
  assert.ok(checkInvitation("Bonjour Monsieur Martin, ?", "Vincent", "Besson").errors.includes("bad_greeting"));
});
