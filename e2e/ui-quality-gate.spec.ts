import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function moduleCard(page: Page, id: string) {
  return page.locator(`[data-module-id="${id}"]`);
}

function elapsedSeconds(value: string) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

async function threadEndpoint(page: Page, id: string, end: "start" | "end") {
  return page.locator(`[data-connection-id="${id}"] .thread-path`).evaluate((path, endpoint) => {
    const svgPath = path as SVGPathElement;
    const point = svgPath.getPointAtLength(endpoint === "start" ? 0 : svgPath.getTotalLength());
    const screen = point.matrixTransform(svgPath.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, end);
}

async function portCenter(page: Page, label: string) {
  const box = await page.getByRole("button", { name: label }).boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  const closeWorkshop = page.getByRole("button", { name: "Close workshop" });
  if (await closeWorkshop.isVisible()) await closeWorkshop.click();
});

test("approved UI interaction journey remains coherent", async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const elapsed = page.getByLabel("Elapsed test session time").locator("b");
  await page.getByRole("button", { name: "Play session" }).click();
  const startedAt = elapsedSeconds(await elapsed.innerText());
  await expect.poll(async () => elapsedSeconds(await elapsed.innerText()), { timeout: 3_000 }).toBeGreaterThan(startedAt);
  await page.getByRole("button", { name: "Stop session" }).click();
  expect(elapsedSeconds(await elapsed.innerText())).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "More tools" }).click();

  const length = moduleCard(page, "length");
  const attack = moduleCard(page, "attack");
  await length.locator(".module-body").click();
  await expect(length.locator(".module-body")).toHaveAttribute("aria-pressed", "true");
  await expect(length).toHaveCSS("outline-style", "solid");
  await expect(page.getByLabel("Duration")).toBeHidden();
  await page.getByText("Timing", { exact: true }).click();
  await expect(page.getByLabel("Duration")).toBeVisible();
  await page.getByText("Timing", { exact: true }).click();
  await expect(page.getByLabel("Duration")).toBeHidden();
  await page.getByText("Timing", { exact: true }).click();
  await expect(page.getByLabel("Duration")).toBeVisible();
  await page.getByLabel("Duration").selectOption("1/2");
  await expect(length.locator(".module-footer")).toContainText("1/2");

  await page.getByRole("button", { name: "Compact", exact: true }).click();
  const compactStart = await threadEndpoint(page, "thread-4", "start");
  const compactEnd = await threadEndpoint(page, "thread-4", "end");
  const compactSourcePort = await portCenter(page, "Output port for Note Length");
  const compactTargetPort = await portCenter(page, "Input port for Attack");
  expect(Math.hypot(compactStart.x - compactSourcePort.x, compactStart.y - compactSourcePort.y)).toBeLessThan(2);
  expect(Math.hypot(compactEnd.x - compactTargetPort.x, compactEnd.y - compactTargetPort.y)).toBeLessThan(2);
  await page.getByRole("button", { name: "Studio", exact: true }).click();

  await attack.locator(".module-body").click();
  await page.getByLabel("Duration").selectOption("250 ms");
  await expect(attack.locator(".module-footer")).toContainText("250 ms");
  await length.locator(".module-body").click();
  await expect(page.getByLabel("Duration")).toHaveValue("1/2");

  const trackedThread = page.locator('[data-connection-id="thread-4"] .thread-path');
  const beforeThreadPath = await trackedThread.getAttribute("d");
  const beforePosition = await length.getAttribute("style");
  const box = await length.locator(".module-body").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 34, box!.y + box!.height / 2 + 18, { steps: 5 });
  await page.mouse.up();
  await expect(length).not.toHaveAttribute("style", beforePosition ?? "");
  expect(await trackedThread.getAttribute("d")).not.toBe(beforeThreadPath);

  const threadCount = page.locator(".connection-layer g[data-connection-id]");
  await expect(threadCount).toHaveCount(8);
  await page.getByRole("button", { name: "Output port for Attack" }).click();
  await page.getByRole("button", { name: "Input port for Sample Slots 01–16" }).click();
  await expect(threadCount).toHaveCount(9);
  const createdConnectionId = await page.locator(".connection-layer g.selected").getAttribute("data-connection-id");
  expect(createdConnectionId).toBeTruthy();
  const createdThread = page.locator(`[data-connection-id="${createdConnectionId}"] .thread-path`);
  const createdPath = await createdThread.getAttribute("d");
  const attackBox = await attack.locator(".module-body").boundingBox();
  expect(attackBox).not.toBeNull();
  await page.mouse.move(attackBox!.x + attackBox!.width / 2, attackBox!.y + attackBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(attackBox!.x + attackBox!.width / 2 - 28, attackBox!.y + attackBox!.height / 2 + 12, { steps: 5 });
  await page.mouse.up();
  expect(await createdThread.getAttribute("d")).not.toBe(createdPath);
  await page.locator(`[data-connection-id="${createdConnectionId}"] .thread-hit`).dispatchEvent("click");
  await expect(page.getByText("Selected Thread", { exact: true })).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(threadCount).toHaveCount(8);

  await length.locator(".module-body").click();
  await page.getByText("Note / Chord", { exact: true }).click();
  await page.getByRole("button", { name: "Mono" }).click();
  await expect(page.getByRole("button", { name: "Mono" })).toHaveClass(/active/);
  await page.getByLabel("Root Note").selectOption("G3");
  await expect(page.getByLabel("Root Note")).toHaveValue("G3");
  await page.getByText("Timing", { exact: true }).click();
  await page.getByRole("slider", { name: "Swing" }).fill("61");
  await expect(length.locator(".module-footer")).toContainText("Swing 61%");
  await page.getByText("Injection", { exact: true }).click();
  await page.getByLabel("Randomize Seed").uncheck();
  await page.getByText("Routing", { exact: true }).click();
  await page.getByRole("button", { name: "Muted", exact: true }).click();
  await expect(page.getByRole("button", { name: "Muted", exact: true })).toHaveClass(/active/);

  await moduleCard(page, "audio").locator(".module-body").click();
  await expect(page.getByText("Future module — controls and connections are unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Output port for Audio In unavailable/ })).toBeDisabled();
  await expect(page.getByText("AUDIO IN", { exact: true })).toBeVisible();
  await expect(page.locator(".module-card")).toHaveCount(10);

  await length.locator(".module-body").click();
  await attack.locator(".module-body").click({ modifiers: ["Shift"] });
  await expect(length.locator(".module-body")).toHaveAttribute("aria-pressed", "true");
  await expect(attack.locator(".module-body")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("2 modules", { exact: true })).toBeVisible();
  const groupLengthPosition = await length.getAttribute("style");
  const groupAttackPosition = await attack.getAttribute("style");
  const groupBox = await length.locator(".module-body").boundingBox();
  expect(groupBox).not.toBeNull();
  await page.mouse.move(groupBox!.x + groupBox!.width / 2, groupBox!.y + groupBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(groupBox!.x + groupBox!.width / 2 + 18, groupBox!.y + groupBox!.height / 2 + 12, { steps: 4 });
  await page.mouse.up();
  await expect(length).not.toHaveAttribute("style", groupLengthPosition ?? "");
  await expect(attack).not.toHaveAttribute("style", groupAttackPosition ?? "");
  await page.getByText("Batch actions", { exact: true }).click();
  await page.getByRole("button", { name: "Duplicate batch" }).click();
  await expect(page.locator(".module-card")).toHaveCount(12);
  await page.getByRole("button", { name: "Delete batch" }).click();
  await expect(page.locator(".module-card")).toHaveCount(10);

  await page.getByLabel("Module type to add").selectOption("note-length");
  await page.getByRole("button", { name: "Add module" }).click();
  await expect(page.locator(".module-card")).toHaveCount(11);
  await page.getByLabel("Node name").fill("Review Timing");
  await expect(page.getByRole("button", { name: /Timing control Review Timing/ })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".module-card")).toHaveCount(10);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear workspace" }).click();
  await expect(page.locator(".module-card")).toHaveCount(0);
  await expect(threadCount).toHaveCount(0);
  await expect(page.getByRole("application", { name: "Audio module routing canvas" }).getByText("Workspace cleared", { exact: true })).toBeVisible();
  const workspace = page.getByRole("application", { name: "Audio module routing canvas" });
  const baselineWidth = (await workspace.boundingBox())!.width;
  await page.getByRole("button", { name: "Extend workspace by 50%" }).click();
  await expect(page.getByText("Extension +50%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Extend workspace by 50%" }).click();
  await expect(page.getByText("Extension +100%", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retract workspace by 50%" })).toBeVisible();
  expect(Number.parseFloat(await page.locator(".canvas-stage").evaluate((element) => getComputedStyle(element).width))).toBeCloseTo(baselineWidth * 2, 1);
  await page.getByRole("button", { name: "Retract workspace by 50%" }).click();
  expect(Number.parseFloat(await page.locator(".canvas-stage").evaluate((element) => getComputedStyle(element).width))).toBeCloseTo(baselineWidth * 1.5, 1);
  await page.getByRole("button", { name: "Retract workspace by 50%" }).click();
  await expect(page.getByRole("button", { name: "Extend workspace by 50%" })).toBeVisible();

  expect(consoleErrors, "browser console errors").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});

test("directional workspaces preserve Threads state and stop at workflow boundaries", async ({ page }) => {
  const desktop = page.locator(".rfe-desktop");
  await expect(desktop).toHaveAttribute("data-current-workspace", "threads");
  await expect(page.getByLabel("Threads workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to Threads" })).toHaveCount(0);

  await moduleCard(page, "length").locator(".module-body").click();
  await page.getByText("Timing", { exact: true }).click();
  await page.getByLabel("Duration").selectOption("1/2");
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await expect(desktop).toHaveAttribute("data-current-workspace", "sound-desk");
  await expect(page.getByRole("heading", { name: "Sound Desk" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to Threads" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to Visualiser" })).toBeVisible();
  for (const name of ["Go to Threads", "Go to Visualiser"]) {
    const edgeButton = page.getByRole("button", { name });
    await edgeButton.hover();
    await expect(edgeButton.locator("small")).toBeVisible();
    await expect.poll(async () => (await edgeButton.boundingBox())?.width ?? 0).toBeGreaterThan(120);
    const edgeBox = await edgeButton.boundingBox();
    expect(edgeBox).not.toBeNull();
    expect(edgeBox!.x).toBeGreaterThanOrEqual(0);
    expect(edgeBox!.x + edgeBox!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
  }

  await page.getByRole("button", { name: "Go to Visualiser" }).click();
  await expect(desktop).toHaveAttribute("data-current-workspace", "visualiser");
  await expect(page.getByRole("heading", { name: "Visualiser" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to Visualiser" })).toHaveCount(0);
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await expect(desktop).toHaveAttribute("data-current-workspace", "sound-desk");
  await page.getByRole("button", { name: "Go to Threads" }).click();
  await expect(desktop).toHaveAttribute("data-current-workspace", "threads");
  await expect(page.getByLabel("Duration")).toHaveValue("1/2");

  await expect.poll(async () => {
    const returnedStart = await threadEndpoint(page, "thread-4", "start");
    const returnedSourcePort = await portCenter(page, "Output port for Note Length");
    return Math.hypot(returnedStart.x - returnedSourcePort.x, returnedStart.y - returnedSourcePort.y);
  }).toBeLessThan(2);
  await expect.poll(async () => {
    const returnedEnd = await threadEndpoint(page, "thread-4", "end");
    const returnedTargetPort = await portCenter(page, "Input port for Attack");
    return Math.hypot(returnedEnd.x - returnedTargetPort.x, returnedEnd.y - returnedTargetPort.y);
  }).toBeLessThan(2);

  const returnedThreadCount = page.locator(".connection-layer g[data-connection-id]");
  await page.getByRole("button", { name: "Output port for Attack" }).click();
  await page.getByRole("button", { name: "Input port for Sample Slots 01–16" }).click();
  await expect(returnedThreadCount).toHaveCount(9);
  await page.keyboard.press("Delete");
  await expect(returnedThreadCount).toHaveCount(8);

  await page.setViewportSize({ width: 640, height: 800 });
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
});

test("reduced-motion navigation changes workspace without transition animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const closeWorkshop = page.getByRole("button", { name: "Close workshop" });
  if (await closeWorkshop.isVisible()) await closeWorkshop.click();
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await expect(page.locator(".rfe-desktop")).toHaveAttribute("data-current-workspace", "sound-desk");
  await expect(page.locator(".workspace-surface")).toHaveCSS("animation-name", "none");
});

test("one shared session timer remains visible and continuous across every workspace", async ({ page }) => {
  const elapsed = page.getByLabel("Elapsed test session time").locator("b");
  await expect(page.getByLabel("Elapsed test session time")).toHaveCount(1);
  await page.getByRole("button", { name: "Play session" }).click();
  const threadsTime = elapsedSeconds(await elapsed.innerText());
  await expect.poll(async () => elapsedSeconds(await elapsed.innerText()), { timeout: 3_000 }).toBeGreaterThan(threadsTime);

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await expect(page.getByLabel("Elapsed test session time")).toBeVisible();
  const soundDeskTime = elapsedSeconds(await elapsed.innerText());
  await expect.poll(async () => elapsedSeconds(await elapsed.innerText()), { timeout: 3_000 }).toBeGreaterThan(soundDeskTime);

  await page.getByRole("button", { name: "Go to Visualiser" }).click();
  await expect(page.getByLabel("Elapsed test session time")).toBeVisible();
  const visualiserTime = elapsedSeconds(await elapsed.innerText());
  expect(visualiserTime).toBeGreaterThanOrEqual(soundDeskTime);

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await page.getByRole("button", { name: "Go to Threads" }).click();
  expect(elapsedSeconds(await elapsed.innerText())).toBeGreaterThanOrEqual(visualiserTime);
  await page.getByRole("button", { name: "Pause session" }).click();
  const pausedTime = elapsedSeconds(await elapsed.innerText());
  await page.waitForTimeout(1_100);
  expect(elapsedSeconds(await elapsed.innerText())).toBe(pausedTime);
  await page.getByRole("button", { name: "Resume session" }).click();
  await expect.poll(async () => elapsedSeconds(await elapsed.innerText()), { timeout: 3_000 }).toBeGreaterThan(pausedTime);
  await page.getByRole("button", { name: "Stop session" }).click();
  expect(elapsedSeconds(await elapsed.innerText())).toBe(0);
});

test("Threads outputs drive the Sound Desk Plotter and Visualiser inspection", async ({ page }) => {
  const terminals = page.getByLabel("Thread channel output terminals");
  await expect(terminals.locator(".channel-output-terminal.complete")).toHaveCount(1);
  await expect(page.locator('[data-channel-output="channel-01"]')).toHaveCount(1);

  await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  await expect(page.getByLabel("CH 02 output incomplete")).toBeVisible();
  await page.getByRole("button", { name: "Output port for Attack" }).click();
  await page.getByRole("button", { name: "CH 02 output terminal incomplete" }).click();
  await expect(terminals.locator(".channel-output-terminal.complete")).toHaveCount(2);

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  const soundGrid = page.getByRole("grid", { name: "Sound Desk shared 5 by 5 spatial grid" });
  await expect(soundGrid.getByRole("gridcell")).toHaveCount(25);
  await expect(page.getByRole("button", { name: "CH 01 · complete and routable" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "CH 02 · complete and routable" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /CH 03/ })).toHaveCount(0);
  await expect(soundGrid.locator(".spatial-channel-node")).toHaveCount(1);

  await page.getByRole("button", { name: "CH 02 · complete and routable" }).click();
  await soundGrid.locator('[data-coordinate="-2,-1"]').click();
  await expect(page.getByText("CH 02→(-2,-1)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Plot route" }).click();
  await expect(soundGrid.locator('[data-coordinate="-2,-1"] [data-channel-id="channel-02"]')).toBeVisible();
  await expect(page.locator('.plotter-channel-row[data-channel-id="channel-02"]')).toContainText("(-2,-1)");

  await page.getByRole("button", { name: "Go to Visualiser" }).click();
  await page.getByRole("button", { name: "Reveal routing inspection" }).click();
  const inspectionGrid = page.getByRole("grid", { name: "Visualiser routing inspection 5 by 5 spatial grid" });
  await expect(inspectionGrid.locator('[data-coordinate="-2,-1"] [data-channel-id="channel-02"]')).toBeVisible();
  const inspectionBox = await inspectionGrid.boundingBox();
  expect(inspectionBox).not.toBeNull();
  expect(Math.abs(inspectionBox!.width - inspectionBox!.height)).toBeLessThan(2);

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await page.getByRole("button", { name: "Go to Threads" }).click();
  await page.getByRole("button", { name: "Remove CH 02" }).click();
  await page.getByRole("button", { name: "REMOVE CH 02", exact: true }).click();
  await expect(page.getByLabel("CH 02 output complete")).toHaveCount(0);
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await expect(page.getByRole("button", { name: /CH 02/ })).toHaveCount(0);
  await expect(soundGrid.locator('[data-channel-id="channel-02"]')).toHaveCount(0);

  await page.setViewportSize({ width: 640, height: 800 });
  const box = await soundGrid.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
});

test("placing a sine player transfers it from the channel menu into Threads for explicit Channel Out wiring", async ({ page }) => {
  await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  const channelFixture = page.locator('.input-channel-fixture[data-channel-id="channel-02"]');
  await expect(channelFixture.locator(".audio-test-controls")).toBeVisible();
  await page.getByRole("button", { name: "Place CH 02 sine source in Threads" }).click();

  const sourceNode = page.locator('[data-module-type="sine-source"][data-module-id*="channel-02"]');
  await expect(sourceNode).toHaveCount(1);
  await expect(sourceNode.locator(".module-title")).toHaveText("CH 02 Sine");
  await expect(channelFixture.locator(".audio-test-controls")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Thread Inspector" })).toContainText("Placed source");
  await expect(page.getByRole("region", { name: "Thread Inspector" })).toContainText("Removing the node returns its player");

  await sourceNode.getByRole("button", { name: "Output port for CH 02 Sine" }).click();
  await page.getByRole("button", { name: "CH 02 output terminal incomplete" }).click();
  await expect(page.getByLabel("CH 02 output complete")).toBeVisible();
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await expect(page.getByLabel("Session transport")).toBeVisible();
  await expect(page.getByRole("button", { name: "CH 02 · complete and routable" })).toBeEnabled();
  await page.getByRole("button", { name: "CH 02 · complete and routable" }).click();
  await page.getByRole("grid", { name: "Sound Desk shared 5 by 5 spatial grid" }).locator('[data-coordinate="2,0"]').click();
  await page.getByRole("button", { name: "Plot route" }).click();
  await expect(page.locator('.plotter-channel-row[data-channel-id="channel-02"]')).toContainText("(2,0)");

  await page.getByRole("button", { name: "Go to Threads" }).click();
  await sourceNode.locator(".module-body").click();
  await page.getByRole("button", { name: "CH 02 start sine signal" }).click();
  await expect(page.getByRole("button", { name: "CH 02 stop sine signal" })).toBeVisible();
  const beforeDisconnect = await page.evaluate(() => {
    const runtime = (window as typeof window & { __rfeAudioRuntime: { getChannelSnapshot(id: string): { active: boolean; routable: boolean; effectiveLevel: number }; getDiagnostics(): { sourceCreations: number; activeSources: number } } }).__rfeAudioRuntime;
    const snapshot = runtime.getChannelSnapshot("channel-02");
    const diagnostics = runtime.getDiagnostics();
    return { snapshot: { active: snapshot.active, routable: snapshot.routable, effectiveLevel: snapshot.effectiveLevel }, diagnostics: { sourceCreations: diagnostics.sourceCreations, activeSources: diagnostics.activeSources } };
  });
  expect(beforeDisconnect.snapshot).toMatchObject({ active: true, routable: true, effectiveLevel: 20 });
  await page.getByRole("button", { name: "Disconnect CH 02 output" }).click();
  await expect.poll(() => page.evaluate(() => {
    const runtime = (window as typeof window & { __rfeAudioRuntime: { getChannelSnapshot(id: string): { active: boolean; routable: boolean; effectiveLevel: number }; getDiagnostics(): { sourceCreations: number; activeSources: number } } }).__rfeAudioRuntime;
    const snapshot = runtime.getChannelSnapshot("channel-02");
    const diagnostics = runtime.getDiagnostics();
    return { snapshot: { active: snapshot.active, routable: snapshot.routable, effectiveLevel: snapshot.effectiveLevel }, diagnostics: { sourceCreations: diagnostics.sourceCreations, activeSources: diagnostics.activeSources } };
  })).toEqual({ snapshot: { active: true, routable: false, effectiveLevel: 0 }, diagnostics: beforeDisconnect.diagnostics });
  await expect(page.getByLabel("CH 02 output incomplete")).toBeVisible();
  await page.getByRole("button", { name: "Remove from workspace" }).click();
  await expect(sourceNode).toHaveCount(0);
  await expect(channelFixture.locator(".audio-test-controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Place CH 02 sine source in Threads" })).toBeVisible();
  await expect(page.getByLabel("CH 02 output incomplete")).toBeVisible();
});

test("Inputs, workspace tools, and Monitor expand context without losing construction state", async ({ page }) => {
  await expect(page.locator(".input-channel-row")).toHaveCount(1);
  const canvas = page.getByRole("application", { name: "Audio module routing canvas" });
  const initialWidth = (await canvas.boundingBox())!.width;

  await moduleCard(page, "length").locator(".module-body").click();
  await expect(page.getByRole("status", { name: "Selection monitor" })).toContainText("NOTE LENGTH");
  await expect(page.getByRole("status", { name: "Selection monitor" })).toContainText("CH 01 / 01");
  await expect(page.getByLabel("Layered signal monitor idle; no sounding channels")).toContainText("NO SIGNAL");

  await page.getByRole("button", { name: "Collapse Inputs and Channels" }).click();
  await expect(page.getByRole("button", { name: "Expand Inputs and Channels" })).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(initialWidth);
  await expect(moduleCard(page, "length").locator(".module-body")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Expand Inputs and Channels" }).click();
  await expect(page.locator(".input-channel-row")).toHaveCount(1);

  await expect(page.getByLabel("Module type to add")).toHaveCount(0);
  await page.getByRole("button", { name: "More tools" }).click();
  await expect(page.getByLabel("Module type to add")).toBeVisible();
  await page.getByRole("button", { name: "Hide tools" }).click();
  await expect(page.getByLabel("Module type to add")).toHaveCount(0);
});

test("many channels remain readable, scrollable, and removable", async ({ page }) => {
  const channelList = page.locator(".input-channel-list");
  const fixtures = page.locator(".input-channel-fixture");

  for (let channel = 2; channel <= 24; channel += 1) {
    await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  }

  await expect(fixtures).toHaveCount(24);
  const dimensions = await channelList.evaluate((list) => ({ clientHeight: list.clientHeight, scrollHeight: list.scrollHeight }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(await fixtures.first().evaluate((fixture) => fixture.getBoundingClientRect().height)).toBeGreaterThan(42);
  expect(await fixtures.last().evaluate((fixture) => fixture.getBoundingClientRect().height)).toBeGreaterThanOrEqual(42);

  await page.getByRole("button", { name: "Remove CH 24" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Remove CH 24" }).click();
  await page.getByRole("button", { name: "REMOVE CH 24", exact: true }).click();
  await expect(fixtures).toHaveCount(23);
  await expect(page.getByRole("button", { name: "Remove CH 24" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove CH 23" })).toBeVisible();
});

test("channel numbering resets after the final active channel is removed", async ({ page }) => {
  await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  await expect(page.getByRole("button", { name: "Remove CH 03" })).toBeVisible();

  for (const label of ["CH 01", "CH 02", "CH 03"]) {
    await page.getByRole("button", { name: `Remove ${label}` }).click();
    await page.getByRole("button", { name: `REMOVE ${label}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Remove ${label}` })).toHaveCount(0);
  }

  await expect(page.locator(".input-channel-fixture")).toHaveCount(0);
  await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  await expect(page.getByRole("button", { name: "Remove CH 01" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove CH 04" })).toHaveCount(0);
});

test("channel removal warning remains non-blocking and preserves unrelated playback", async ({ page }) => {
  await page.goto("/?audioDiagnostic=native-fence");
  await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  await page.getByRole("button", { name: "CH 01 start sine signal" }).click();
  await page.getByRole("button", { name: "Play session" }).click();
  const audioState = () => page.evaluate(() => {
    const runtime = (window as typeof window & { __rfeAudioRuntime: { getActiveChannelIds(): string[]; getSessionPlaybackState(): string } }).__rfeAudioRuntime;
    return { activeIds: runtime.getActiveChannelIds(), playback: runtime.getSessionPlaybackState() };
  });
  await expect.poll(audioState).toEqual({ activeIds: ["channel-01"], playback: "playing" });

  await page.getByRole("button", { name: "Remove CH 02" }).click();
  await expect(page.getByRole("alert")).toContainText("Other sounding channels remain uninterrupted");
  await expect.poll(audioState).toEqual({ activeIds: ["channel-01"], playback: "playing" });
  await page.getByRole("button", { name: "CANCEL", exact: true }).click();
  await expect.poll(audioState).toEqual({ activeIds: ["channel-01"], playback: "playing" });

  await page.getByRole("button", { name: "Remove CH 02" }).click();
  await page.getByRole("button", { name: "REMOVE CH 02", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove CH 02" })).toHaveCount(0);
  await expect.poll(audioState).toEqual({ activeIds: ["channel-01"], playback: "playing" });
});

test("CH 01 audio keeps one shared master while source lifecycle remains channel-scoped", async ({ page }) => {
  test.setTimeout(60_000);
  const diagnostics = () => page.evaluate(() => (window as typeof window & { __rfeAudioRuntime: { getDiagnostics(): { masterCreations: number; channelCreations: number; sourceCreations: number; sourceDisposals: number; activeSources: number } } }).__rfeAudioRuntime.getDiagnostics());
  const monitor = page.getByRole("status", { name: "Selection monitor" });

  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __rfeAudioRuntime?: unknown }).__rfeAudioRuntime))).toBe(true);

  await expect(page.getByRole("button", { name: "CH 01 start sine signal" })).toBeVisible();
  await expect(page.getByLabel("Layered signal monitor idle; no sounding channels")).toContainText("NO SIGNAL");
  expect((await diagnostics()).masterCreations).toBe(0);

  await page.getByRole("slider", { name: "CH 01 sine frequency" }).fill("156");
  await page.getByRole("slider", { name: "CH 01 level" }).fill("10");
  expect((await diagnostics()).masterCreations).toBe(0);
  await page.getByRole("button", { name: "CH 01 start sine signal" }).click();
  await expect(page.getByRole("button", { name: "CH 01 stop sine signal" })).toBeVisible();
  await expect(monitor).toContainText("SINE");
  await expect(monitor).toContainText("156 Hz · LEVEL 10%");
  await expect(monitor).toContainText("ACTIVE · CENTRED OUTPUT");
  await expect(page.getByLabel("Layered signal monitor active with 1 sounding channel")).toContainText("LAYERED VIEW · 1 TRACE");
  await expect(page.getByLabel("Master safety meter")).toContainText("dBFS");
  await expect(page.getByLabel("Master safety meter")).toContainText("NORMAL");
  await expect.poll(() => page.evaluate(() => {
    const safety = (window as typeof window & { __rfeAudioRuntime: { getMasterSafetySnapshot(): { available: boolean; currentPeakDbfs: number; state: string } } }).__rfeAudioRuntime.getMasterSafetySnapshot();
    return safety.available && Number.isFinite(safety.currentPeakDbfs) && safety.state === "NORMAL";
  })).toBe(true);
  await expect.poll(async () => (await diagnostics()).activeSources).toBe(1);
  expect(await diagnostics()).toMatchObject({ masterCreations: 1, channelCreations: 1, sourceCreations: 1, activeSources: 1 });

  await page.getByRole("slider", { name: "CH 01 sine frequency" }).fill("78");
  await page.getByRole("slider", { name: "CH 01 level" }).fill("5");
  await expect(monitor).toContainText("78 Hz · LEVEL 5%");
  await page.getByRole("button", { name: "Decrease CH 01 frequency by 1 Hz" }).click();
  await expect(monitor).toContainText("77 Hz · LEVEL 5%");
  await page.getByRole("button", { name: "Increase CH 01 frequency by 1 Hz" }).click();
  await expect(monitor).toContainText("78 Hz · LEVEL 5%");
  expect((await diagnostics()).sourceCreations).toBe(1);

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await page.getByRole("button", { name: "Go to Visualiser" }).click();
  expect(await diagnostics()).toMatchObject({ masterCreations: 1, channelCreations: 1, sourceCreations: 1, activeSources: 1 });
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await page.getByRole("button", { name: "Go to Threads" }).click();
  await expect(page.getByRole("button", { name: "CH 01 stop sine signal" })).toBeVisible();
  expect(await diagnostics()).toMatchObject({ masterCreations: 1, channelCreations: 1, sourceCreations: 1, activeSources: 1 });

  await page.getByRole("button", { name: "CH 01 stop sine signal" }).click();
  await expect(page.getByLabel("Layered signal monitor idle; no sounding channels")).toContainText("NO SIGNAL");
  await expect.poll(async () => (await diagnostics()).activeSources).toBe(0);
  await page.getByRole("button", { name: "CH 01 start sine signal" }).click();
  await expect.poll(async () => (await diagnostics()).sourceCreations).toBe(2);
  expect(await diagnostics()).toMatchObject({ masterCreations: 1, channelCreations: 1, activeSources: 1 });
  await page.getByRole("button", { name: "CH 01 stop sine signal" }).click();
  await expect.poll(async () => (await diagnostics()).activeSources).toBe(0);
});

test("five dynamic sine channels remain isolated through control, deletion, Monitor selection, and navigation", async ({ page }) => {
  test.setTimeout(90_000);
  type AudioDiagnostics = { contextCreations: number; masterCreations: number; channelCreations: number; channelDisposals: number; analyserCreations: number; analyserDisposals: number; activeChannels: number; sourceCreations: number; sourceDisposals: number; activeSources: number };
  const diagnostics = () => page.evaluate(() => (window as typeof window & { __rfeAudioRuntime: { getDiagnostics(): AudioDiagnostics } }).__rfeAudioRuntime.getDiagnostics());
  const monitor = page.getByRole("status", { name: "Selection monitor" });

  for (let count = 0; count < 4; count += 1) await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  await expect(page.locator(".input-channel-fixture")).toHaveCount(5);
  const expectedFrequencies = [78, 110, 156, 221, 312];
  for (const [index, frequency] of expectedFrequencies.entries()) {
    const label = `CH ${String(index + 1).padStart(2, "0")}`;
    await expect(page.getByRole("slider", { name: `${label} sine frequency` })).toHaveValue(String(frequency));
    await page.getByRole("slider", { name: `${label} level` }).fill("8");
    await page.getByRole("button", { name: `${label} start sine signal` }).click();
  }
  await expect.poll(async () => (await diagnostics()).activeSources).toBe(5);
  expect(await diagnostics()).toMatchObject({ contextCreations: 1, masterCreations: 1, channelCreations: 5, analyserCreations: 5, activeChannels: 5, sourceCreations: 5, activeSources: 5 });

  await page.getByRole("slider", { name: "CH 03 sine frequency" }).fill("180");
  await page.getByRole("slider", { name: "CH 04 level" }).fill("4");
  await expect(page.getByRole("slider", { name: "CH 01 sine frequency" })).toHaveValue("78");
  await expect(page.getByRole("slider", { name: "CH 05 sine frequency" })).toHaveValue("312");
  await expect(page.getByRole("slider", { name: "CH 03 level" })).toHaveValue("8");
  await expect(page.getByRole("slider", { name: "CH 04 level" })).toHaveValue("4");
  expect((await diagnostics()).sourceCreations).toBe(5);

  for (const [channelId, label, frequency, level] of [
    ["channel-01", "CH 01", 78, 8],
    ["channel-02", "CH 02", 110, 8],
    ["channel-03", "CH 03", 180, 8],
    ["channel-04", "CH 04", 221, 4],
    ["channel-05", "CH 05", 312, 8],
  ] as const) {
    await page.locator(`[data-channel-id="${channelId}"] .channel-select`).click();
    await expect(monitor).toContainText(`${label} / 05`);
    await expect(monitor).toContainText(`${frequency} Hz · LEVEL ${level}%`);
    // Only the default CH 01 is connected to Channel Out in this isolation fixture.
    await expect(page.getByLabel("Layered signal monitor active with 1 sounding channel")).toContainText("LAYERED VIEW · 1 TRACE");
  }
  expect((await diagnostics()).sourceCreations).toBe(5);

  await page.getByRole("button", { name: "CH 03 stop sine signal" }).click();
  await expect.poll(async () => (await diagnostics()).activeSources).toBe(4);
  for (const label of ["CH 01", "CH 02", "CH 04", "CH 05"]) await expect(page.getByRole("button", { name: `${label} stop sine signal` })).toBeVisible();
  await page.getByRole("button", { name: "CH 03 start sine signal" }).click();
  await expect.poll(async () => (await diagnostics()).activeSources).toBe(5);
  expect(await diagnostics()).toMatchObject({ masterCreations: 1, sourceCreations: 6, activeSources: 5 });

  await page.getByRole("button", { name: "Remove CH 02" }).click();
  await page.getByRole("button", { name: "REMOVE CH 02", exact: true }).click();
  await expect.poll(async () => (await diagnostics()).activeSources).toBe(4);
  await expect(page.getByRole("button", { name: "Remove CH 02" })).toHaveCount(0);
  expect(await diagnostics()).toMatchObject({ masterCreations: 1, channelDisposals: 1, analyserDisposals: 1, activeChannels: 4, activeSources: 4 });
  for (const label of ["CH 01", "CH 03", "CH 04", "CH 05"]) await expect(page.getByRole("button", { name: `${label} stop sine signal` })).toBeVisible();

  await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  await expect(page.getByRole("button", { name: "Remove CH 06" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "CH 06 sine frequency" })).toHaveValue("441");
  await page.getByRole("button", { name: "CH 06 start sine signal" }).click();
  await expect.poll(async () => (await diagnostics()).activeSources).toBe(5);
  expect(await diagnostics()).toMatchObject({ masterCreations: 1, channelCreations: 6, activeChannels: 5, sourceCreations: 7 });

  const beforeNavigation = await diagnostics();
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await page.getByRole("button", { name: "Go to Visualiser" }).click();
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await page.getByRole("button", { name: "Go to Threads" }).click();
  expect(await diagnostics()).toMatchObject({ masterCreations: beforeNavigation.masterCreations, channelCreations: beforeNavigation.channelCreations, sourceCreations: beforeNavigation.sourceCreations, activeSources: beforeNavigation.activeSources });
  await expect(page.getByRole("button", { name: "CH 06 stop sine signal" })).toBeVisible();
});

test("Sound Desk pan and Live Trim feed one smoothed session gate controlled by Visualiser transport", async ({ page }) => {
  test.setTimeout(90_000);
  type ChannelSnapshot = { frequency: number; level: number; liveTrim: number; effectiveLevel: number; pan: number; active: boolean };
  type AudioDiagnostics = { masterCreations: number; sessionGateCreations: number; pannerCreations: number; sourceCreations: number; activeSources: number; smoothingRamps: number };
  const audioState = () => page.evaluate(() => {
    const runtime = (window as typeof window & { __rfeAudioRuntime: { getChannelSnapshot(id: string): ChannelSnapshot; getSessionPlaybackState(): string; getDiagnostics(): AudioDiagnostics; getActiveChannelIds(): string[] } }).__rfeAudioRuntime;
    return { channel01: runtime.getChannelSnapshot("channel-01"), channel02: runtime.getChannelSnapshot("channel-02"), playback: runtime.getSessionPlaybackState(), diagnostics: runtime.getDiagnostics(), activeIds: runtime.getActiveChannelIds() };
  });

  await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  await page.getByRole("button", { name: "Output port for Attack" }).click();
  await page.getByRole("button", { name: "CH 02 output terminal incomplete" }).click();
  await page.getByRole("button", { name: "CH 01 start sine signal" }).click();
  await page.getByRole("button", { name: "CH 02 start sine signal" }).click();
  await expect.poll(async () => (await audioState()).diagnostics.activeSources).toBe(2);
  await page.getByRole("button", { name: "CH 02 stop sine signal" }).click();
  await expect.poll(async () => (await audioState()).activeIds).toEqual(["channel-01"]);
  const beforeSpatial = await audioState();

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  const soundGrid = page.getByRole("grid", { name: "Sound Desk shared 5 by 5 spatial grid" });
  await page.getByRole("button", { name: "CH 01 · complete and routable" }).click();
  await soundGrid.locator('[data-coordinate="-2,2"]').click();
  await page.getByRole("button", { name: "Plot route" }).click();
  await expect.poll(async () => (await audioState()).channel01.pan).toBe(-1);
  expect((await audioState()).channel02.pan).toBe(0);
  expect((await audioState()).diagnostics.sourceCreations).toBe(beforeSpatial.diagnostics.sourceCreations);

  const trim = page.getByRole("slider", { name: "CH 01 Live Trim" });
  await trim.fill("16");
  await expect.poll(async () => (await audioState()).channel01.effectiveLevel).toBe(23.2);
  expect((await audioState()).channel01).toMatchObject({ level: 20, liveTrim: 16, pan: -1, active: true });
  await trim.fill("-50");
  await expect.poll(async () => (await audioState()).channel01.effectiveLevel).toBe(10);
  await trim.fill("-100");
  await expect.poll(async () => (await audioState()).channel01.effectiveLevel).toBe(0);
  expect((await audioState()).channel01.active).toBe(true);
  await page.getByRole("button", { name: "Go to Threads" }).click();
  await page.locator('[data-channel-id="channel-01"] .channel-select').click();
  const monitor = page.getByRole("status", { name: "Selection monitor" });
  await expect(monitor).toContainText("SD MUTED");
  await expect(monitor).toContainText("SOUND DESK LIVE TRIM -100%");
  await expect(page.getByLabel("Layered signal monitor idle; focused channel Sound Desk muted")).toContainText("SD MUTED");
  await expect(page.getByRole("slider", { name: "CH 01 level" })).toHaveValue("20");
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await page.getByRole("button", { name: "Reset CH 01 Live Trim to 0" }).click();
  await expect.poll(async () => (await audioState()).channel01.effectiveLevel).toBe(20);

  await soundGrid.locator('[data-coordinate="-2,-2"]').click();
  await page.getByRole("button", { name: "Plot route" }).click();
  await expect.poll(async () => (await audioState()).channel01.pan).toBe(-1);
  await soundGrid.locator('[data-coordinate="2,-2"]').click();
  await page.getByRole("button", { name: "Plot route" }).click();
  await expect.poll(async () => (await audioState()).channel01.pan).toBe(1);
  expect((await audioState()).diagnostics.sourceCreations).toBe(beforeSpatial.diagnostics.sourceCreations);

  await page.getByRole("button", { name: "Go to Visualiser" }).click();
  await expect(page.getByLabel("Session transport")).toContainText("PLAYING");
  await page.getByRole("button", { name: "Pause session" }).click();
  await expect.poll(async () => (await audioState()).playback).toBe("paused");
  expect((await audioState()).activeIds).toEqual(["channel-01"]);
  await page.getByRole("button", { name: "Resume session" }).click();
  await expect.poll(async () => (await audioState()).playback).toBe("playing");
  await page.getByRole("button", { name: "Stop session" }).click();
  await expect.poll(async () => (await audioState()).playback).toBe("stopped");
  expect((await audioState()).activeIds).toEqual(["channel-01"]);
  await page.getByRole("button", { name: "Play session" }).click();
  await expect.poll(async () => (await audioState()).playback).toBe("playing");

  const afterTransport = await audioState();
  expect(afterTransport.diagnostics).toMatchObject({ masterCreations: 1, sessionGateCreations: 1, pannerCreations: 2, sourceCreations: beforeSpatial.diagnostics.sourceCreations, activeSources: 1 });
  expect(afterTransport.channel01).toMatchObject({ level: 20, liveTrim: 0, effectiveLevel: 20, pan: 1, active: true });
  expect(afterTransport.channel02.active).toBe(false);
  expect(afterTransport.diagnostics.smoothingRamps).toBeGreaterThan(beforeSpatial.diagnostics.smoothingRamps);

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await expect(page.locator('.plotter-channel-row[data-channel-id="channel-01"]')).toContainText("(2,-2)");
  await expect(page.getByRole("slider", { name: "CH 01 Live Trim" })).toHaveValue("0");
  await page.getByRole("button", { name: "Go to Threads" }).click();
  await expect(page.getByRole("slider", { name: "CH 01 level" })).toHaveValue("20");
  await expect(page.getByRole("button", { name: "CH 01 stop sine signal" })).toBeVisible();
});

test("approved shell has no serious or critical axe violations", async ({ page }) => {
  test.setTimeout(60_000);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
});

test("Clone Inspector keeps shared source programming read-only and follows root edits", async ({ page }) => {
  await page.getByRole("button", { name: "Place CH 01 sine source in Threads" }).click();
  await expect(page.getByText("Source actions", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clone", exact: true }).click();

  const inspector = page.getByLabel("Thread Inspector");
  await expect(inspector.getByText("CLONE OF CH 01 · SHARED SOURCE")).toBeVisible();
  await expect(inspector.getByText("LOCKED — ADJUST AT SOURCE")).toBeVisible();
  await expect(inspector.getByLabel(/sine frequency/i)).toHaveCount(0);
  await expect(inspector.getByLabel(/level/i)).toHaveCount(0);
  const cloneNode = page.locator('[data-module-id^="sine-clone-channel-02"]');
  await cloneNode.getByRole("button", { name: "Output port for CH 02 Clone" }).click();
  await page.getByRole("button", { name: "CH 02 output terminal incomplete" }).click();
  await expect(inspector.getByText("ROUTED", { exact: true })).toBeVisible();
  await expect(page.locator('.channel-output-terminal[data-channel-id="channel-02"] .channel-terminal-source-tag')).toHaveText("CH 02 Clone");

  await page.locator('[data-module-id^="sine-source-channel-01"] .module-body').click();
  await page.getByLabel("CH 01 sine frequency").fill("70");
  await page.getByRole("button", { name: "CH 01 start sine signal" }).click();
  await expect.poll(() => page.evaluate(() => {
    const runtime = (window as typeof window & { __rfeAudioRuntime: { getSoundingChannelIds(): string[] } }).__rfeAudioRuntime;
    return runtime.getSoundingChannelIds().sort();
  })).toEqual(["channel-01", "channel-02"]);
  await expect(page.getByLabel("Layered signal monitor active with 2 sounding channels")).toHaveAttribute("data-trace-count", "2");
  await expect(page.getByLabel("Layered signal monitor active with 2 sounding channels")).toContainText("LAYERED VIEW · 2 TRACES");
  await page.locator('[data-module-id^="sine-clone-channel-02"] .module-body').click();
  await expect(inspector.getByText("70 Hz", { exact: true })).toBeVisible();
  await expect(inspector.getByText("LEVEL 20%", { exact: true })).toBeVisible();
  await expect(inspector.getByText("POSITION + LIVE TRIM AT SOUND DESK", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Quick Delete" })).toBeEnabled();

  await page.locator('[data-module-id^="sine-source-channel-01"] .module-body').click();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  const duplicateNode = page.locator('[data-module-id^="sine-source-channel-03"]');
  await duplicateNode.getByRole("button", { name: "Output port for CH 03 Sine" }).click();
  await page.getByRole("button", { name: "CH 03 output terminal incomplete" }).click();
  await page.getByRole("button", { name: "CH 03 start sine signal" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __rfeAudioRuntime: { getSoundingChannelIds(): string[] } }).__rfeAudioRuntime.getSoundingChannelIds().sort())).toEqual(["channel-01", "channel-02", "channel-03"]);

  await page.locator('[data-module-id^="sine-source-channel-01"] .module-body').click();
  await page.getByRole("button", { name: "DELETE SOURCE…" }).click();
  await expect(inspector.getByRole("alert")).toContainText("Unrelated sources keep playing");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __rfeAudioRuntime: { getSoundingChannelIds(): string[]; getSessionPlaybackState(): string } }).__rfeAudioRuntime.getSoundingChannelIds().sort())).toEqual(["channel-01", "channel-02", "channel-03"]);
  await page.getByRole("button", { name: "CANCEL" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __rfeAudioRuntime: { getSoundingChannelIds(): string[] } }).__rfeAudioRuntime.getSoundingChannelIds().sort())).toEqual(["channel-01", "channel-02", "channel-03"]);

  await page.getByRole("button", { name: "DELETE SOURCE…" }).click();
  await page.getByRole("button", { name: "DELETE SOURCE + ALL CLONES" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __rfeAudioRuntime: { getSoundingChannelIds(): string[] } }).__rfeAudioRuntime.getSoundingChannelIds())).toEqual(["channel-03"]);
  await expect(duplicateNode).toBeVisible();
});

test("a source can mix and match with any free Channel Out", async ({ page }) => {
  await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  await page.getByRole("button", { name: "Place CH 02 sine source in Threads" }).click();
  await page.getByRole("button", { name: "Disconnect CH 01 output" }).click();
  const source = page.locator('[data-module-id^="sine-source-channel-02"]');
  await source.getByRole("button", { name: "Output port for CH 02 Sine" }).click();
  await page.getByRole("button", { name: "CH 01 output terminal incomplete" }).click();
  await expect(page.getByLabel("CH 01 output complete")).toBeVisible();
  await expect(page.locator('.channel-output-terminal[data-channel-id="channel-01"] .channel-terminal-source-tag')).toHaveText("CH 02 Sine");

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await expect(page.getByRole("button", { name: "CH 02 · complete and routable" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "CH 01 · incomplete" })).toBeDisabled();
});

test("M11 dense 25-position qualification keeps routing, transport, Monitor, Clone, and Duplicate truth", async ({ page }) => {
  test.setTimeout(240_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (let count = 1; count < 17; count += 1) await page.getByRole("button", { name: "ADD CHANNEL" }).click();
  const frequencies = [50, 53, 56, 78, 110, 220, 221, 330, 440, 441, 550, 880, 1_000, 1_750, 3_500, 6_600, 10_000];
  for (let sequence = 1; sequence <= 17; sequence += 1) {
    const label = `CH ${String(sequence).padStart(2, "0")}`;
    await page.getByRole("slider", { name: `${label} sine frequency` }).fill(String(frequencies[sequence - 1]));
    await page.getByRole("slider", { name: `${label} level` }).fill("2");
    await page.getByRole("button", { name: `Place ${label} sine source in Threads` }).click();
    if (sequence > 1) {
      const source = page.locator(`[data-module-id^="sine-source-channel-${String(sequence).padStart(2, "0")}"]`);
      await source.getByRole("button", { name: `Output port for ${label} Sine` }).click();
      await page.getByRole("button", { name: `${label} output terminal incomplete` }).click();
    }
  }

  const rootOne = page.locator('[data-module-id^="sine-source-channel-01"]');
  for (let clone = 0; clone < 4; clone += 1) {
    await rootOne.locator(".module-body").evaluate((element: HTMLElement) => element.click());
    await page.getByRole("button", { name: "Clone", exact: true }).click();
  }
  const rootTwo = page.locator('[data-module-id^="sine-source-channel-02"]');
  for (let duplicate = 0; duplicate < 4; duplicate += 1) {
    await rootTwo.locator(".module-body").evaluate((element: HTMLElement) => element.click());
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  }
  await expect(page.locator('[data-module-type="sine-source"]')).toHaveCount(25);

  for (let sequence = 18; sequence <= 25; sequence += 1) {
    const label = `CH ${String(sequence).padStart(2, "0")}`;
    const title = sequence <= 21 ? `${label} Clone` : `${label} Sine`;
    const source = page.locator(`[data-module-id^="sine-${sequence <= 21 ? "clone" : "source"}-channel-${String(sequence).padStart(2, "0")}"]`);
    await source.getByRole("button", { name: `Output port for ${title}` }).evaluate((element: HTMLElement) => element.click());
    await page.getByRole("button", { name: `${label} output terminal incomplete` }).click();
  }

  const startSequences = [...Array.from({ length: 17 }, (_, index) => index + 1), 22, 23, 24, 25];
  for (const sequence of startSequences) {
    const label = `CH ${String(sequence).padStart(2, "0")}`;
    const source = page.locator(`[data-module-id^="sine-source-channel-${String(sequence).padStart(2, "0")}"]`);
    await source.locator(".module-body").evaluate((element: HTMLElement) => element.click());
    await page.getByRole("button", { name: `${label} start sine signal` }).click();
    await expect(page.getByRole("button", { name: `${label} stop sine signal` })).toBeVisible();
  }

  await expect.poll(() => page.evaluate(() => {
    const runtime = (window as typeof window & { __rfeAudioRuntime: { getDiagnostics(): { activeChannels: number; activeSources: number; contextCreations: number; masterCreations: number; safetyCreations: number }; getActiveChannelIds(): string[]; getSoundingChannelIds(): string[] } }).__rfeAudioRuntime;
    return { ...runtime.getDiagnostics(), activeEndpoints: runtime.getActiveChannelIds().length, soundingEndpoints: runtime.getSoundingChannelIds().length };
  }), { timeout: 20_000 }).toMatchObject({ activeChannels: 25, activeSources: 21, activeEndpoints: 25, soundingEndpoints: 25, contextCreations: 1, masterCreations: 1, safetyCreations: 1 });

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  const coordinates = [
    "-2,2", "-1,2", "0,2", "1,2", "2,2", "-2,1", "-1,1", "0,1", "1,1", "2,1",
    "-2,0", "-1,0", "0,0", "1,0", "2,0", "-2,-1", "-1,-1", "0,-1", "1,-1", "2,-1",
    "-2,-2", "-1,-2", "0,-2", "1,-2", "2,-2",
  ];
  for (let sequence = 1; sequence <= 25; sequence += 1) {
    const label = `CH ${String(sequence).padStart(2, "0")}`;
    await page.getByRole("button", { name: `${label} · complete and routable` }).click();
    await page.getByRole("grid", { name: "Sound Desk shared 5 by 5 spatial grid" }).locator(`[data-coordinate="${coordinates[sequence - 1]}"]`).click();
    await page.getByRole("button", { name: "Plot route" }).click();
  }
  await expect(page.locator(".spatial-channel-node")).toHaveCount(25);

  for (const [first, second] of [[1, 2], [18, 19], [22, 23]]) {
    for (const [sequence, coordinate] of [[first, coordinates[second - 1]], [second, coordinates[first - 1]]]) {
      const label = `CH ${String(sequence).padStart(2, "0")}`;
      await page.getByRole("button", { name: `${label} · complete and routable` }).click();
      await page.getByRole("grid", { name: "Sound Desk shared 5 by 5 spatial grid" }).locator(`[data-coordinate="${coordinate}"]`).click();
      await page.getByRole("button", { name: "Plot route" }).click();
    }
  }
  await expect(page.locator(".spatial-channel-node")).toHaveCount(25);

  const sourceCreations = await page.evaluate(() => (window as typeof window & { __rfeAudioRuntime: { getDiagnostics(): { sourceCreations: number } } }).__rfeAudioRuntime.getDiagnostics().sourceCreations);
  for (let cycle = 0; cycle < 12; cycle += 1) {
    const transportName = cycle % 3 === 0 ? "Pause session" : cycle % 3 === 1 ? /^(Play|Resume) session$/ : "Stop session";
    await page.getByRole("button", { name: transportName }).click();
  }
  await page.getByRole("button", { name: "Play session" }).click();
  expect(await page.evaluate(() => (window as typeof window & { __rfeAudioRuntime: { getDiagnostics(): { sourceCreations: number; contextCreations: number; safetyCreations: number } } }).__rfeAudioRuntime.getDiagnostics())).toMatchObject({ sourceCreations, contextCreations: 1, safetyCreations: 1 });

  await page.getByRole("button", { name: "Go to Threads" }).click();
  for (const sequence of [18, 22, 3]) {
    const label = `CH ${String(sequence).padStart(2, "0")}`;
    await page.getByRole("button", { name: `Disconnect ${label} output` }).click();
    await expect.poll(() => page.evaluate((channelId) => !(window as typeof window & { __rfeAudioRuntime: { getSoundingChannelIds(): string[] } }).__rfeAudioRuntime.getSoundingChannelIds().includes(channelId), `channel-${String(sequence).padStart(2, "0")}`)).toBe(true);
  }
  for (const sequence of [3, 22, 18]) {
    const label = `CH ${String(sequence).padStart(2, "0")}`;
    const type = sequence === 18 ? "clone" : "source";
    const title = sequence === 18 ? `${label} Clone` : `${label} Sine`;
    const source = page.locator(`[data-module-id^="sine-${type}-channel-${String(sequence).padStart(2, "0")}"]`);
    await source.getByRole("button", { name: `Output port for ${title}` }).evaluate((element: HTMLElement) => element.click());
    await page.getByRole("button", { name: `${label} output terminal incomplete` }).click();
  }
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __rfeAudioRuntime: { getSoundingChannelIds(): string[] } }).__rfeAudioRuntime.getSoundingChannelIds().length)).toBe(25);
  await expect(page.getByLabel("Layered signal monitor active with 25 sounding channels")).toContainText("LAYERED VIEW · 25 TRACES");
  await expect(page.getByLabel("Layered signal monitor active with 25 sounding channels")).toHaveAttribute("data-trace-count", "25");
  await expect(page.locator(".signal-monitor canvas")).toHaveCount(1);
  await expect(page.getByLabel("Master safety meter")).toContainText("dBFS");
  await page.evaluate(() => {
    const deadline = performance.now() + 200;
    while (performance.now() < deadline) Math.sqrt(123_456.789);
  });
  await expect.poll(() => page.evaluate(() => {
    const runtime = (window as typeof window & { __rfeAudioRuntime: { getDiagnostics(): { safetyListeners: number }; getMasterSafetySnapshot(): { available: boolean; currentPeakDbfs: number; state: string } } }).__rfeAudioRuntime;
    const safety = runtime.getMasterSafetySnapshot();
    return safety.available && Number.isFinite(safety.currentPeakDbfs) && safety.state !== "SAFETY MUTE" && runtime.getDiagnostics().safetyListeners === 1;
  })).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("audio reduction modes visibly remove only diagnostic observation layers", async ({ page }) => {
  await page.goto("/?audioDiagnostic=no-observers");
  await expect(page.getByText("TRACE OFF", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Master safety meter")).toContainText("REPORT OFF");
  await expect(page.getByLabel("Master safety meter")).toContainText("AUDIO-THREAD PROTECTION RETAINED");

  await page.goto("/?audioDiagnostic=no-scope");
  await expect(page.getByText("TRACE OFF", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Master safety meter")).not.toContainText("REPORT OFF");

  await page.goto("/?audioDiagnostic=no-meter");
  await expect(page.getByText("TRACE OFF", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Master safety meter")).toContainText("REPORT OFF");

  await page.goto("/?audioDiagnostic=minimal-fence");
  await expect(page.getByText("TRACE OFF", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Master safety meter")).toContainText("REPORT OFF");

  await page.goto("/?audioDiagnostic=native-fence");
  await expect(page.getByText("TRACE OFF", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Master safety meter")).toContainText("REPORT OFF");

  await page.goto("/?audioDiagnostic=native-fence-scope");
  await expect(page.getByText("TRACE OFF", { exact: true })).toHaveCount(0);
  await expect(page.locator(".signal-monitor canvas")).toHaveCount(1);
  await expect(page.getByLabel("Master safety meter")).toContainText("REPORT OFF");
  const nativeFencePeak = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 1_024, 48_000);
    const source = context.createConstantSource();
    source.offset.value = 8;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -9;
    compressor.knee.value = 0;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    const fence = context.createWaveShaper();
    const ceiling = 10 ** (-6 / 20);
    fence.curve = Float32Array.from({ length: 65_537 }, (_, index) => Math.max(-ceiling, Math.min(ceiling, index / 65_536 * 2 - 1)));
    source.connect(compressor).connect(fence).connect(context.destination);
    source.start();
    const rendered = await context.startRendering();
    return Math.max(...rendered.getChannelData(0).map(Math.abs));
  });
  expect(nativeFencePeak).toBeLessThanOrEqual(10 ** (-6 / 20) + 1e-6);
});
