// Unit test of navigate(): it must wait for the NEW page, not a late "complete" of the previous one.
// Run: node --test test/tabs.test.mjs
import { build } from "esbuild";
import { test } from "node:test";
import assert from "node:assert/strict";

const bundle = await build({
  entryPoints: [new URL("../src/lib/tabs.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "neutral",
});
const mod = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

function fakeChrome() {
  const listeners = new Set();
  return {
    emit: (id, info, tab) => [...listeners].forEach((l) => l(id, info, tab)),
    chrome: {
      tabs: {
        onUpdated: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) },
        update: async () => {},
      },
    },
  };
}

test("navigate ignores the late 'complete' of the previous page (messaging) and waits for the profile", async () => {
  const f = fakeChrome();
  globalThis.chrome = f.chrome;
  const target = "https://www.linkedin.com/in/anissa-el-ghayat/";
  let resolved = false;
  const p = mod.navigate(7, target, 5000).then(() => { resolved = true; });
  // The messaging page finishes loading AFTER the navigation request: must be ignored.
  f.emit(7, { status: "complete" }, { url: "https://www.linkedin.com/messaging/" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(resolved, false);
  // Another tab: ignored.
  f.emit(8, { status: "loading" }, { url: target });
  f.emit(8, { status: "complete" }, { url: target });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(resolved, false);
  // The profile loads.
  f.emit(7, { status: "loading" }, { url: target });
  f.emit(7, { status: "complete" }, { url: target + "?originalSubdomain=fr" });
  await p;
  assert.equal(resolved, true);
});

test("navigate settles on a redirect (e.g. login page) instead of hanging", async () => {
  const f = fakeChrome();
  globalThis.chrome = f.chrome;
  const t0 = Date.now();
  const p = mod.navigate(3, "https://www.linkedin.com/in/someone/", 10000);
  f.emit(3, { status: "loading" }, { url: "https://www.linkedin.com/in/someone/" });
  f.emit(3, { status: "complete" }, { url: "https://www.linkedin.com/authwall" });
  await p;
  assert.ok(Date.now() - t0 < 6000);
});

test("samePage: trailing slash, query and case do not matter; another profile does", () => {
  assert.equal(mod.samePage("https://www.linkedin.com/in/Jean-Dupont?x=1", "https://www.linkedin.com/in/jean-dupont/"), true);
  assert.equal(mod.samePage("https://www.linkedin.com/in/jean-dupont-2/", "https://www.linkedin.com/in/jean-dupont/"), false);
  assert.equal(mod.samePage("https://www.linkedin.com/messaging/", "https://www.linkedin.com/in/jean-dupont/"), false);
});
