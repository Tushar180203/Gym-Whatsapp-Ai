import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../../packages/messaging/src/whatsapp/inbound-adapter.js";
test.beforeEach(async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); await admin.query("drop schema if exists ownership_web_test cascade"); await admin.query("create schema ownership_web_test"); await admin.end();
  const parsed = new URL(process.env.TEST_DATABASE_URL!); parsed.searchParams.set("options", "-c search_path=ownership_web_test");
  const app = new PostgresVerticalSliceApp({ connectionString: parsed.toString() }); try { await app.migrate(); } finally { await app.close(); }
});
for (const width of [1280,390]) test(`self-service number ownership and workout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto("/onboarding");
  await page.getByLabel("Email", { exact: true }).fill(`proof-${width}@example.com`); await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByRole("heading", { name: "New routine", exact: true })).toBeVisible();
  await page.getByLabel("Routine name", { exact: true }).fill("My plan"); await page.getByLabel("Session name", { exact: true }).first().fill("Push");
  await page.getByRole("button", { name: "Add exercise", exact: true }).first().click(); await page.getByRole("combobox", { name: "Exercise", exact: true }).first().selectOption({ label: "Barbell Bench Press" });
  await page.getByLabel("Sets", { exact: true }).first().fill("1"); await page.getByLabel("Min reps", { exact: true }).first().fill("10");
  await page.getByRole("button", { name: "Save routine", exact: true }).click(); await expect(page.getByRole("button", { name: "My plan", exact: true })).toBeVisible();
  const phone = page.getByLabel("WhatsApp phone number", { exact: true }); await phone.fill("9685719847");
  const create = page.getByRole("button", { name: "Verify on WhatsApp", exact: true }); await expect(create).toBeDisabled();
  await page.getByLabel("I want to use WhatsApp to receive and log my workouts.", { exact: true }).check(); await create.click();
  expect(await phone.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false); expect((await (await page.request.get("/api/whatsapp/link")).json()).status).toBe("NOT_CONNECTED");
  await phone.fill("+91 96857 19847"); await create.click(); await expect(page.getByRole("heading", { name: "Verify your WhatsApp" })).toBeVisible();
  const code = (await page.locator(".link-token").innerText()).split(" ")[1]!;
  await expect(page.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", `https://wa.me/15551234567?text=LINK%20${code}`);
  const before = await (await page.request.get("/api/whatsapp/link")).json(); await page.reload(); await expect(page.getByText("Waiting for WhatsApp verification", { exact: true }).first()).toBeVisible();
  expect((await (await page.request.get("/api/whatsapp/link")).json()).pending.id).toBe(before.pending.id);
  let n = 0; const adapter = new WhatsAppInboundAdapter("ownership-web-secret");
  async function send(text: string, from = "919685719847", id = `web-proof-${n++}`) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "123456" }, messages: [{ id, from, timestamp: String(Math.floor(Date.now()/1000)), text: { body: text } }] } }] }] });
    const response = await page.request.post("/api/webhooks/whatsapp", { data: raw, headers: { "x-hub-signature-256": adapter.sign(raw) } }); expect(response.status()).toBe(200); return (await response.json())[0];
  }
  expect((await send(`LINK ${code}`, "919685719848")).verificationRejected).toBe(true); await send(`LINK ${code}`, "919685719847", "verified-once"); await send(`LINK ${code}`, "919685719847", "verified-once");
  await expect(page.getByText("WhatsApp connected", { exact: true })).toBeVisible({ timeout: 15000 }); await expect(page.getByText("+91 ******9847", { exact: true })).toBeVisible();
  await send("START"); await send("start planned"); await send("45x10", "919685719847", "set-once"); await send("45x10", "919685719847", "set-once"); await send("done");
  expect((await (await page.request.get("/api/workouts/history")).json())).toHaveLength(1);
  await page.getByRole("button", { name: "Change WhatsApp number", exact: true }).click(); await phone.fill("+919685719848"); await page.getByLabel("I want to use WhatsApp to receive and log my workouts.", { exact: true }).check(); await page.getByRole("button", { name: "Verify on WhatsApp", exact: true }).click();
  await expect(page.locator(".link-token")).toBeVisible(); const newCode = (await page.locator(".link-token").innerText()).split(" ")[1]!;
  expect((await (await page.request.get("/api/whatsapp/link")).json()).verified.id).toBe((await (await page.request.get("/api/whatsapp/link")).json()).links.find((link: { maskedNumber: string }) => link.maskedNumber === "+91 ******9847").id);
  await send(`LINK ${newCode}`, "919685719848"); await expect(page.getByText("+91 ******9848", { exact: true })).toBeVisible({ timeout: 15000 });
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Disconnect WhatsApp", exact: true }).click(); expect((await (await page.request.get("/api/whatsapp/link")).json()).status).toBe("VERIFIED");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Disconnect WhatsApp", exact: true }).click(); await expect(page.getByText("WhatsApp disconnected", { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/whatsapp-ownership-${width}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
