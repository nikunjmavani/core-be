import type { z } from 'zod';
import { envSchema } from './env-schema.js';

export { envSchemaKeys } from './env-schema.js';

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    const missingOrInvalid = Object.entries(details)
      .filter(([, errors]) => (errors?.length ?? 0) > 0)
      .map(([key]) => key)
      .join(', ');
    throw new Error(`Missing or invalid environment variables: ${missingOrInvalid}`);
  }

  _env = parsed.data;
  return _env;
}

export const env = getEnv();

/** Test-only: clear cached parsed env after changing `process.env`. */
export function resetEnvCacheForTests(): void {
  _env = null;
}
