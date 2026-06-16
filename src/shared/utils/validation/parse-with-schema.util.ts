import { z } from 'zod';
import type { ZodType } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';

/**
 * Default i18n key raised by {@link parseWithSchema} when a request payload
 * fails schema validation. Override per call for domain-specific copy
 * (for example `'errors:validation.invalidPagination'`).
 */
export const DEFAULT_INVALID_INPUT_ERROR_KEY = 'errors:invalidInput';

/**
 * Parse `data` with a Zod `schema`, returning the typed value on success or
 * throwing a {@link ValidationError} carrying flattened per-field errors on
 * failure.
 *
 * @remarks
 * Consolidates the `safeParse → flattenError → throw ValidationError` block
 * that was duplicated across every domain `*.validator.ts`. The thrown error
 * mirrors the previous inline shape exactly: `messageKey` set to `errorKey`,
 * no message params, and `z.flattenError(...).fieldErrors` as the details that
 * the error handler expands into the Paddle-style `errors[]` list.
 */
export function parseWithSchema<T>(
  schema: ZodType<T>,
  data: unknown,
  errorKey: string = DEFAULT_INVALID_INPUT_ERROR_KEY,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(errorKey, undefined, z.flattenError(result.error).fieldErrors);
  }
  return result.data;
}
