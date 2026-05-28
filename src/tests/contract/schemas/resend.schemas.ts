import { z } from 'zod';

/** Zod contract for the JSON body our mail service sends to Resend's `POST /emails`. */
export const ResendEmailsOutgoingJsonContractSchema = z.object({
  from: z.string().min(1),
  to: z.array(z.string()),
  subject: z.string(),
  html: z.string(),
  text: z.string().optional(),
  reply_to: z.string().optional(),
});

/** Variant of {@link ResendEmailsOutgoingJsonContractSchema} that allows the optional `tags` array Resend supports. */
export const ResendEmailsOutgoingJsonWithTagsContractSchema =
  ResendEmailsOutgoingJsonContractSchema.extend({
    tags: z.array(z.object({ name: z.string(), value: z.string() })),
  }).partial({ tags: true });

/** Zod contract for Resend's success envelope on `POST /emails` (we only care about `id`). */
export const ResendEmailsSuccessfulResponseContractSchema = z.object({
  id: z.string().min(1),
});

/** Zod contract for Resend's error envelope; ensures our error parser sees the documented shape. */
export const ResendEmailsErrorEnvelopeContractSchema = z.object({
  data: z.null(),
  error: z.object({
    statusCode: z.number().optional(),
    message: z.string().optional(),
    name: z.string().optional(),
  }),
});
