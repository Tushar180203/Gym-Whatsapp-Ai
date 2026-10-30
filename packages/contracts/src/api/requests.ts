import { z } from "zod";

// Every JSON endpoint accepts an object; route/domain schemas validate its fields.
export const jsonRequestObjectSchema = z.record(z.string(), z.unknown());

const email = z.email().max(254);
const password = z.string().max(256);
export const signupRequestSchema = z.object({ email, password: password.min(12) }).strict();
export const loginRequestSchema = z.object({ email, password: password.min(1) }).strict();
