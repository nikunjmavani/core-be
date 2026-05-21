import { z } from 'zod';

export const ResendEmailsOutgoingJsonContractSchema = z.object({
  from: z.string().min(1),
  to: z.array(z.string()),
  subject: z.string(),
  html: z.string(),
  text: z.string().optional(),
  reply_to: z.string().optional(),
});

export const ResendEmailsOutgoingJsonWithTagsContractSchema =
  ResendEmailsOutgoingJsonContractSchema.extend({
    tags: z.array(z.object({ name: z.string(), value: z.string() })),
  }).partial({ tags: true });

export const ResendEmailsSuccessfulResponseContractSchema = z.object({
  id: z.string().min(1),
});

export const ResendEmailsErrorEnvelopeContractSchema = z.object({
  data: z.null(),
  error: z.object({
    statusCode: z.number().optional(),
    message: z.string().optional(),
    name: z.string().optional(),
  }),
});
