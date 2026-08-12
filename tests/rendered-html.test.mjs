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
  assert.match(html, /data-current-workspace="threads"/);
  assert.match(html, /aria-label="Threads workspace"/);
  assert.match(html, /aria-label="Go to Sound Desk"/);
  assert.match(html, /Thread Inspector/);
  assert.match(html, /Diagnostics/);
  assert.match(html, /ELAPSED/);
  assert.match(html, /shell-elapsed-readout/);
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
  assert.match(html, /Module editing tools/);
  assert.match(html, /Add module/);
  assert.match(html, /Select all/);
  assert.match(html, /Clear workspace/);
  assert.match(html, /Extend workspace by 50%/);
  assert.match(html, /Extend \+50%/);
  assert.match(html, /Node name/);
  assert.doesNotMatch(html, /<details[^>]*inspector-section[^>]*open/i);
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
  assert.match(config, /DARK_UI_CONFIG:[\s\S]*workspacePadding:\s*12/);
  assert.match(config, /DARK_UI_CONFIG:[\s\S]*nodeMinHeight:\s*48/);
  assert.match(config, /DARK_UI_CONFIG:[\s\S]*nodeWidth:\s*135/);
  assert.match(config, /DARK_UI_CONFIG:[\s\S]*nodePadding:\s*8/);
});

test("includes lightweight responsive and reduced-motion workspace navigation", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /data-workspace-surface=/);
  assert.match(source, /touch-workspace-navigation/);
  assert.match(css, /workspace-edge:hover,\s*\.workspace-edge:focus-within\s*\{\s*width:\s*132px/);
  assert.match(css, /workspace-edge button small[^}]*white-space:\s*nowrap/);
  assert.match(source, /Go to \$\{getWorkspace\(previous\)\.label\}/);
  assert.match(source, /Go to \$\{getWorkspace\(next\)\.label\}/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\), \(max-width: 760px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /workspace-enter-forward, \.workspace-enter-backward \{ animation: none !important; \}/);
});

test("Sound Desk and Visualiser share the canonical spatial grid component", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const model = await readFile(new URL("../app/spatial-routing.ts", import.meta.url), "utf8");
  const channels = await readFile(new URL("../app/channel-routing.ts", import.meta.url), "utf8");
  assert.match(source, /function SpatialGrid/);
  assert.match(source, /<SpatialGrid state=\{state\} variant="sound-desk"/);
  assert.match(source, /<SpatialGrid state=\{state\} variant="inspection"/);
  assert.match(source, /useReducer\(spatialRoutingReducer, undefined, createInitialSpatialRoutingState\)/);
  assert.match(model, /X increases left -> right; Y increases bottom -> top/);
  assert.doesNotMatch(model, /coordinateToChannel|occupiedBy/);
  assert.match(css, /--spatial-grid-line:\s*color-mix\(in srgb, var\(--text-dim\) 70%, transparent\)/);
  assert.match(css, /border-left:\s*1px dashed var\(--spatial-grid-line\)/);
  assert.match(css, /border-top:\s*1px dashed var\(--spatial-grid-line\)/);
  assert.match(source, /channel\.shortLabel\.padStart\(2, "0"\)/);
  assert.match(channels, /CHANNEL_ACCENT_IDS = \["coral", "stone", "moss", "utility-blue", "air-blue"\]/);
  assert.match(source, /function ThreadChannelBands/);
  assert.match(source, /function ChannelOutputTerminals/);
  assert.match(source, /function ChannelRail/);
  assert.match(source, /function ChannelPlotter/);
  assert.match(source, /function WorkspaceTitlebar/);
  assert.doesNotMatch(source, /Thread outputs arrive here for independent spatial assignment/);
  assert.doesNotMatch(source, /Simulation surface reserved\. Routing inspection is diagnostic only/);
  assert.match(source, /ORCHESTRA \/ ADVANCED/);
  assert.match(source, /x2:\s*canvasSize\.width - 72/);
  assert.match(css, /grid-template-rows:\s*repeat\(5,/);
  assert.match(css, /border-top:\s*1px dashed var\(--thread-band-line\)/);
  assert.match(css, /rfe-desktop\[data-theme="dark"\][^}]*scrollbar-color:\s*#39424a #101418/);
  assert.match(css, /html:has\(\.rfe-desktop\[data-theme="dark"\]\)[\s\S]*color-scheme:\s*dark/);
  assert.match(css, /channel-output-terminal[^}]*right:\s*28px/);
  assert.match(css, /channel-terminal-unlink[^}]*top:\s*2px; right:\s*2px/);
  assert.match(css, /spatial-grid-inspection[^}]*height:\s*auto;[^}]*aspect-ratio:\s*1/);
});
