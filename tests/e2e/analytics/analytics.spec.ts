import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => { page.on("pageerror", error => console.error(error.message)); });
for (const width of [1440, 390]) {
  test(`weekly muscle map and exercise exploration at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.goto("/");
    await expect(page.locator(".analytics[data-ready=true]")).toBeVisible();
    await expect(page.locator(".weekly-metric>strong")).toHaveText(["2", "24", "6/14", "240"]);
    await expect(page.getByRole("group", { name: "Front muscle map" })).toBeVisible();
    await page.getByRole("button", { name: "Back Hamstrings: 3 primary sets, 0 supporting sets", exact: true }).locator("path").first().click();
    await expect(page.locator(".muscle-detail h3")).toHaveText("Hamstrings");
    await expect(page.locator(".muscle-exercise-list")).toContainText("Romanian Deadlift");
    await page.getByRole("checkbox", { name: "Supporting muscles" }).check();
    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(page.locator(".weekly-metric>strong").first()).toHaveText("1");
    await expect(page.locator(".weekly-metric>strong").nth(1)).toHaveText("1");
    await page.getByRole("button", { name: "Back to this week" }).click();
    await page.getByRole("button", { name: "Front Chest: 6 primary sets, 0 supporting sets", exact: true }).locator("path").first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/analytics-overview-${width}.png`, fullPage: true });
    await page.locator(".muscle-exercise-list").getByRole("button", { name: /Barbell Bench Press/ }).click();
    await expect(page.getByRole("tab", { name: "Exercises", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table", { name: "Barbell Bench Press progression" }).locator("tbody tr")).toHaveCount(13);
    await page.getByRole("button", { name: "Volume", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Recorded load × reps (KG)" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/analytics-exercises-${width}.png`, fullPage: true });
    await page.getByRole("tab", { name: "Exercises", exact: true }).focus(); await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Muscles", exact: true })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Exercise Classification" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
test("AI mapping stays estimated and failures preserve the dashboard", async ({ page }) => {
  await page.route("**/api/analytics/insights", route => route.fulfill({ json: { available: true, mappings: [{ exerciseIdentityId: "unknown", primary: ["lats"], secondary: ["biceps"] }], highlightIds: ["coverage"] } }));
  await page.goto("/"); await page.getByRole("button", { name: "Generate AI review" }).click();
  await expect(page.getByRole("status")).toContainText("1 AI exercise mappings");
  await page.getByRole("button", { name: "Back Lats: 3 primary sets, 3 supporting sets", exact: true }).locator("path").first().click();
  await expect(page.locator(".muscle-exercise-list")).toContainText("AI estimate");
  await expect(page.locator(".muscle-breakdown")).toContainText("0 confirmed");
  await page.route("**/api/analytics/insights", route => route.fulfill({ json: { available: false, mappings: [], highlightIds: [] } }));
  await page.getByRole("button", { name: "Refresh AI review" }).click();
  await expect(page.getByText(/AI is unavailable right now/)).toBeVisible();
  await expect(page.locator(".weekly-metric>strong").nth(1)).toHaveText("24");
  await page.route("**/api/analytics/overview", route => route.fulfill({ status: 503 }));
  await page.getByRole("button", { name: "Refresh analytics" }).click();
  await expect(page.getByRole("alert")).toContainText("Analytics unavailable");
});
test("empty history is honest and interactive", async ({ page }) => {
  await page.goto("/?empty");
  await expect(page.getByText("Your progress starts with your first workout.")).toBeVisible();
  await expect(page.locator(".weekly-metric>strong")).toHaveText(["0", "0", "0/14", "0"]);
  await expect(page.getByRole("button", { name: "Generate AI review" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next week" })).toBeDisabled();
  await page.getByRole("tab", { name: "Exercises", exact: true }).click();
  await expect(page.getByText("No recorded history for this exercise.")).toBeVisible();
});
