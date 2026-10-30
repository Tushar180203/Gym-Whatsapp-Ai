import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.url().refine(value => /^postgres(?:ql)?:/.test(value)),
  AI_PROVIDER: z.literal("gemini").default("gemini"),
  AI_MODEL: z.string().min(1).default("gemini-3.5-flash-lite"),
  GEMINI_API_KEY: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_PROVIDER: z.enum(["disabled", "cloud_api"]).default("disabled"),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_RECIPIENT_ENCRYPTION_KEY: z.string().optional(),
  WHATSAPP_GRAPH_API_VERSION: z.string().optional(),
  WHATSAPP_BUSINESS_NUMBER: z.string().optional(),
  WHATSAPP_REMINDER_TEMPLATE_NAME: z.string().regex(/^[a-z][a-z0-9_]{0,511}$/).optional(),
  WHATSAPP_REMINDER_TEMPLATE_LANGUAGE: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/).default("en"),
  APP_ORIGIN: z.url().optional()
});
export function runtimeEnv(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid runtime configuration: ${result.error.issues.map(issue => issue.path.join(".")).join(", ")}`);
  if (result.data.WHATSAPP_PROVIDER === "cloud_api") {
    const checks = {
      WHATSAPP_ACCESS_TOKEN: Boolean(result.data.WHATSAPP_ACCESS_TOKEN?.trim()),
      WHATSAPP_PHONE_NUMBER_ID: /^\d+$/.test(result.data.WHATSAPP_PHONE_NUMBER_ID ?? ""),
      WHATSAPP_VERIFY_TOKEN: Boolean(result.data.WHATSAPP_VERIFY_TOKEN?.trim()),
      WHATSAPP_RECIPIENT_ENCRYPTION_KEY: /^[a-fA-F0-9]{64}$/.test(result.data.WHATSAPP_RECIPIENT_ENCRYPTION_KEY ?? ""),
      WHATSAPP_GRAPH_API_VERSION: /^v\d+\.\d+$/.test(result.data.WHATSAPP_GRAPH_API_VERSION ?? ""),
      WHATSAPP_BUSINESS_NUMBER: /^\+[1-9]\d{7,14}$/.test(result.data.WHATSAPP_BUSINESS_NUMBER ?? "")
    };
    const missing = Object.entries(checks).filter(([, valid]) => !valid).map(([key]) => key);
    if (missing.length) throw new Error(`Invalid WhatsApp configuration: ${missing.join(", ")}`);
  }
  if (env.NODE_ENV === "production" && (!result.data.APP_ORIGIN || !result.data.APP_ORIGIN.startsWith("https://"))) throw new Error("Invalid production configuration: APP_ORIGIN must use HTTPS");
  return result.data;
}
