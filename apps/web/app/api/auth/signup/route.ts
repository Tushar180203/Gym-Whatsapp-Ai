import { productionApp } from "../../../../server/app.js";

export async function POST(input: { email: string; password: string }) {
  return productionApp().signUp(input.email, input.password);
}
