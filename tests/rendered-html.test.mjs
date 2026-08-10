import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the RFE structural shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>RFE Prototype Test-Bed<\/title>/i);
  assert.match(html, /Audio Modules \/ Threads/);
  assert.match(html, /Thread Inspector/);
  assert.match(html, /Diagnostics/);
  assert.match(html, /ELAPSED/);
  assert.match(html, /Start Test Session/);
  assert.match(html, /Active Modules/);
  assert.match(html, /Active Threads/);
  assert.match(html, /Note Length/);
  assert.match(html, /Colour theme/);
  assert.match(html, />Light</);
  assert.match(html, />Dark</);
  assert.match(html, /Grouping accent/);
  assert.match(html, /Clear grouping accent/);
  assert.match(html, /Output port for Note Length/);
  assert.match(html, /Input port for Note Length/);
  assert.match(html, /Highlight style picker/);
  assert.match(html, /Inset bar/);
  assert.match(html, /Full border/);
  assert.match(html, /1\.5 px/);
  assert.doesNotMatch(html, /desktop-grain/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|RFE UI Workshop/i);
});

test("keeps the grouping accent inset from the module border", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const config = await readFile(new URL("../app/ui-config.ts", import.meta.url), "utf8");
  assert.match(css, /top: var\(--grouping-accent-inset\)/);
  assert.match(css, /left: var\(--grouping-accent-side-inset\)/);
  assert.match(css, /--grouping-accent-inset:\s*1px/);
  assert.match(css, /--grouping-accent-side-inset:\s*3px/);
  assert.match(css, /--grouping-accent-thickness:\s*1\.5px/);
  assert.match(config, /groupingAccentStyle:\s*"inset-bar"/);
  assert.match(config, /groupingAccentInset:\s*1,/);
  assert.match(config, /groupingAccentSideInset:\s*3,/);
  assert.match(config, /groupingAccentThickness:\s*1\.5,/);
  assert.match(css, /data-highlight-style="full-border"/);
  assert.match(css, /border: var\(--grouping-accent-thickness\) solid var\(--module-accent\)/);
  assert.doesNotMatch(css, /module-card\.has-accent::before[^}]*top:\s*-1px/s);
});
