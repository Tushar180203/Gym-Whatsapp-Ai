import { z } from "zod";
export const messageTemplateSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,511}$/),
  languageCode: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  bodyParameters: z.array(z.string().min(1).max(900).refine(value => !/[\r\n\t]/.test(value) && !/ {5}/.test(value), "Template parameters must be single-line text")).max(10)
}).strict();
export type MessageTemplate = z.infer<typeof messageTemplateSchema>;
