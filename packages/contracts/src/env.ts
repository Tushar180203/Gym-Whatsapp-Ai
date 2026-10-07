import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.url().refine(value => /^postgres(?:ql)?:/.test(value)),
  AI_PROVIDER: z.literal("gemini").default("gemini"),
  AI_MODEL: z.string().min(1).default("gemini-3.5-flash-lite"),
  GEMINI_API_KEY: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  APP_ORIGIN: z.url().optional()
});
export function runtimeEnv(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid runtime configuration: ${result.error.issues.map(issue => issue.path.join(".")).join(", ")}`);
  if (env.NODE_ENV === "production" && (!result.data.APP_ORIGIN || !result.data.APP_ORIGIN.startsWith("https://"))) throw new Error("Invalid production configuration: APP_ORIGIN must use HTTPS");
  return result.data;
}
