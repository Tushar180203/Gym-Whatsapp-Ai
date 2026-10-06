import { productionApp } from "../../../server/app.js";
import type { WeightUnit } from "../../../../../packages/contracts/src/index.js";

export async function PATCH(input: { sessionToken: string; preferredWeightUnit: WeightUnit; displayName?: string }) {
  const app = productionApp();
  const userId = await app.currentUser(input.sessionToken);
  await app.setPreferredWeightUnit(userId, input.preferredWeightUnit);
  return app.profile(userId);
}

export async function GET(input: { sessionToken: string }) {
  const app = productionApp();
  const userId = await app.currentUser(input.sessionToken);
  return app.profile(userId);
}
