import { productionApp } from "../../../../server/app.js";

export async function POST(input: { sessionToken: string }) {
  await productionApp().logout(input.sessionToken);
  return { ok: true };
}
