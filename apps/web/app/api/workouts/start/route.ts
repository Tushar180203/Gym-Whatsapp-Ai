import { productionApp } from "../../../../server/app.js";

export async function POST(input: { sessionToken: string }) {
  const app = productionApp();
  const userId = await app.currentUser(input.sessionToken);
  return app.startNextWorkout(userId);
}
