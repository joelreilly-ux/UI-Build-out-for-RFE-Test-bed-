import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function moduleCard(page: Page, id: string) {
  return page.locator(`[data-module-id="${id}"]`);
}

function elapsedSeconds(value: string) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  const closeWorkshop = page.getByRole("button", { name: "Close workshop" });
  if (await closeWorkshop.isVisible()) await closeWorkshop.click();
  await page.getByLabel("Preset").selectOption("default");
});

test("approved UI interaction journey remains coherent", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const elapsed = page.getByLabel("Elapsed test session time").locator("b");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const startedAt = elapsedSeconds(await elapsed.innerText());
  await page.waitForTimeout(1_200);
  expect(elapsedSeconds(await elapsed.innerText())).toBeGreaterThan(startedAt);
  await page.getByRole("button", { name: "Reset time" }).click();
  expect(elapsedSeconds(await elapsed.innerText())).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  const length = moduleCard(page, "length");
  const attack = moduleCard(page, "attack");
  await length.locator(".module-body").click();
  await expect(length.locator(".module-body")).toHaveAttribute("aria-pressed", "true");
  await expect(length).toHaveCSS("outline-style", "solid");
  await page.getByLabel("Duration").selectOption("1/2");
  await expect(length.locator(".module-footer")).toContainText("1/2");

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
  await page.getByRole("button", { name: "Mono" }).click();
  await expect(page.getByRole("button", { name: "Mono" })).toHaveClass(/active/);
  await page.getByLabel("Root Note").selectOption("G3");
  await expect(page.getByLabel("Root Note")).toHaveValue("G3");
  await page.getByRole("slider", { name: "Swing" }).fill("61");
  await expect(length.locator(".module-footer")).toContainText("Swing 61%");
  await page.getByLabel("Randomize Seed").uncheck();
  await page.getByRole("button", { name: "Muted", exact: true }).click();
  await expect(page.getByRole("button", { name: "Muted", exact: true })).toHaveClass(/active/);

  await moduleCard(page, "audio").locator(".module-body").click();
  await expect(page.getByText("Future module — controls and connections are unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Output port for Audio In unavailable/ })).toBeDisabled();
  await expect(page.getByText("M:audio", { exact: true })).toBeVisible();
  await expect(page.getByText("Active Modules", { exact: true }).locator("..")).toContainText("8 / 10");

  expect(consoleErrors, "browser console errors").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});

test("approved shell has no serious or critical axe violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
});
