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
  await page.getByLabel("Preset").selectOption("default");
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
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const startedAt = elapsedSeconds(await elapsed.innerText());
  await expect.poll(async () => elapsedSeconds(await elapsed.innerText()), { timeout: 3_000 }).toBeGreaterThan(startedAt);
  await page.getByRole("button", { name: "Reset time" }).click();
  expect(elapsedSeconds(await elapsed.innerText())).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

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

  const threadCount = page.getByText("Active Threads", { exact: true }).locator("..");
  await expect(threadCount).toContainText("8 committed");
  await page.getByRole("button", { name: "Output port for Attack" }).click();
  await page.getByRole("button", { name: "Input port for Sample Slots 01–16" }).click();
  await expect(threadCount).toContainText("9 committed");
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
  await expect(threadCount).toContainText("8 committed");

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
  await expect(page.getByText("M:audio", { exact: true })).toBeVisible();
  await expect(page.getByText("Active Modules", { exact: true }).locator("..")).toContainText("8 / 10");

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
  await expect(page.getByText("Active Modules", { exact: true }).locator("..")).toContainText("9 / 12");
  await page.getByRole("button", { name: "Delete batch" }).click();
  await expect(page.getByText("Active Modules", { exact: true }).locator("..")).toContainText("8 / 10");

  await page.getByLabel("Module type to add").selectOption("note-length");
  await page.getByRole("button", { name: "Add module" }).click();
  await expect(page.getByText("Active Modules", { exact: true }).locator("..")).toContainText("9 / 11");
  await page.getByLabel("Node name").fill("Review Timing");
  await expect(page.getByRole("button", { name: /Timing control Review Timing/ })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Active Modules", { exact: true }).locator("..")).toContainText("8 / 10");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear workspace" }).click();
  await expect(page.getByText("Active Modules", { exact: true }).locator("..")).toContainText("0 / 0");
  await expect(page.getByText("Active Threads", { exact: true }).locator("..")).toContainText("0 committed");
  await expect(page.getByText("Workspace cleared", { exact: true })).toBeVisible();
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

  const returnedThreadCount = page.getByText("Active Threads", { exact: true }).locator("..");
  await page.getByRole("button", { name: "Output port for Attack" }).click();
  await page.getByRole("button", { name: "Input port for Sample Slots 01–16" }).click();
  await expect(returnedThreadCount).toContainText("9 committed");
  await page.keyboard.press("Delete");
  await expect(returnedThreadCount).toContainText("8 committed");

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
  await page.getByRole("button", { name: "Start", exact: true }).click();
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
  await page.getByRole("button", { name: "Pause", exact: true }).click();
});

test("Threads outputs drive the Sound Desk Plotter and Visualiser inspection", async ({ page }) => {
  const terminals = page.getByLabel("Thread channel output terminals");
  await expect(terminals.locator(".channel-output-terminal.complete")).toHaveCount(5);
  await expect(page.locator('[data-channel-output="channel-05"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  const soundGrid = page.getByRole("grid", { name: "Sound Desk shared 5 by 5 spatial grid" });
  await expect(soundGrid.getByRole("gridcell")).toHaveCount(25);
  await expect(page.getByRole("button", { name: "CH 01 · complete and routable" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "CH 05 · complete and routable" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "CH 06 · unused" })).toBeDisabled();
  await expect(soundGrid.locator(".spatial-channel-node")).toHaveCount(5);

  await page.getByRole("button", { name: "CH 05 · complete and routable" }).click();
  await soundGrid.locator('[data-coordinate="-2,-1"]').click();
  await expect(page.getByText("CH 05→(-2,-1)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Plot route" }).click();
  await expect(soundGrid.locator('[data-coordinate="-2,-1"] [data-channel-id="channel-05"]')).toBeVisible();
  await expect(page.locator('.plotter-channel-row[data-channel-id="channel-05"]')).toContainText("(-2,-1)");

  await page.getByRole("button", { name: "Go to Visualiser" }).click();
  await page.getByRole("button", { name: "Reveal routing inspection" }).click();
  const inspectionGrid = page.getByRole("grid", { name: "Visualiser routing inspection 5 by 5 spatial grid" });
  await expect(inspectionGrid.locator('[data-coordinate="-2,-1"] [data-channel-id="channel-05"]')).toBeVisible();
  const inspectionBox = await inspectionGrid.boundingBox();
  expect(inspectionBox).not.toBeNull();
  expect(Math.abs(inspectionBox!.width - inspectionBox!.height)).toBeLessThan(2);

  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await page.getByRole("button", { name: "CH 05 · complete and routable" }).click();
  await soundGrid.locator('[data-coordinate="2,1"]').click();
  await page.getByRole("button", { name: "Plot route" }).click();
  await expect(soundGrid.locator('[data-coordinate="-2,-1"] [data-channel-id="channel-05"]')).toHaveCount(0);
  await expect(soundGrid.locator('[data-coordinate="2,1"] [data-channel-id="channel-05"]')).toBeVisible();
  await page.getByRole("button", { name: "Unplot" }).click();
  await expect(soundGrid.locator('[data-channel-id="channel-05"]')).toHaveCount(0);
  await expect(page.locator('.plotter-channel-row[data-channel-id="channel-05"]')).toContainText("UNPLOTTED");

  await page.getByRole("button", { name: "Go to Threads" }).click();
  await page.getByRole("button", { name: "Disconnect CH 04 output" }).click();
  await expect(page.getByLabel("CH 04 output incomplete")).toBeVisible();
  await page.getByRole("button", { name: "Go to Sound Desk" }).click();
  await expect(page.getByRole("button", { name: "CH 04 · incomplete" })).toBeDisabled();

  await page.setViewportSize({ width: 640, height: 800 });
  const box = await soundGrid.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
});

test("approved shell has no serious or critical axe violations", async ({ page }) => {
  test.setTimeout(60_000);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
});
