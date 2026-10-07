import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";

test.beforeEach(async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists phase_a_web_test cascade"); await admin.query("create schema phase_a_web_test"); await admin.end();
  const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=phase_a_web_test");
  const app = new PostgresVerticalSliceApp({ connectionString: parsed.toString() }); try { await app.migrate(); } finally { await app.close(); }
});
for (const width of [1280, 390]) test(`proposal, alternative, rest and confirmed replacement at ${width}px`, async ({ page }) => {
  expect((await page.request.post("/api/auth/signup", { data: { email: `selection-${width}@example.com`, password: "correct horse battery staple" } })).status()).toBe(200);
  expect((await page.request.patch("/api/profile", { data: { preferredWeightUnit: "KG" } })).status()).toBe(200);
  const created = await page.request.post("/api/routines", { data: { name: "Rotation", sessions: [
    { name: "Upper", exercises: [{ exerciseIdentityId: "global_barbell_bench_press", plannedSetCount: 1, repTargetMin: 8 }, { exerciseIdentityId: "global_lat_pulldown", plannedSetCount: 1, repTargetMin: 10 }] },
    { name: "Lower", exercises: [{ exerciseIdentityId: "global_leg_extension", plannedSetCount: 1, repTargetMin: 10 }] }
  ] } }); expect(created.status()).toBe(200); const routine = await created.json();
  await page.setViewportSize({ width, height: 844 }); await page.goto("/routines");
  const selection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Workout selection", exact: true }) });
  await selection.getByRole("button", { name: "Propose workout", exact: true }).click();
  await expect(selection.getByRole("status")).toContainText("Proposed Upper"); await expect(selection.getByRole("status")).toContainText("Lat Pulldown");
  expect((await (await page.request.get("/api/workouts/active")).json()).status).toBe("PROPOSED");
  await selection.getByRole("combobox", { name: "Workout session", exact: true }).selectOption(routine.sessions[1].id);
  await selection.getByRole("button", { name: "Choose for today", exact: true }).click(); await expect(selection.getByRole("status")).toContainText("Proposed Lower");
  await selection.getByRole("button", { name: "Rest", exact: true }).click(); await expect(selection.getByRole("status")).toContainText("Rest");
  await selection.getByRole("combobox", { name: "Workout session", exact: true }).selectOption("");
  await selection.getByRole("button", { name: "Propose workout", exact: true }).click(); await selection.getByRole("button", { name: "Start planned", exact: true }).click();
  await expect(selection.getByRole("status")).toContainText("Started Upper");
  const original = await (await page.request.get("/api/workouts/active")).json();
  await selection.getByRole("combobox", { name: "Workout session", exact: true }).selectOption(routine.sessions[1].id);
  await selection.getByRole("button", { name: "Replace workout", exact: true }).click(); await expect(selection.getByRole("button", { name: "Confirm replacement", exact: true })).toBeVisible();
  expect((await (await page.request.get("/api/workouts/active")).json()).id).toBe(original.id);
  await selection.getByRole("button", { name: "Confirm replacement", exact: true }).click();
  await expect(selection.getByRole("status")).toContainText("Replace Upper with Lower applied.");
  const replaced = await (await page.request.get("/api/workouts/active")).json(); expect(replaced.id).not.toBe(original.id); expect(replaced.status).toBe("ACTIVE");
  await page.reload(); await selection.getByRole("button", { name: "Propose workout", exact: true }).click(); await expect(selection.getByRole("status")).toContainText("Lower");
  await page.screenshot({ path: `/tmp/phase-a-selection-${width}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
