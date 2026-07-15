import type { z } from 'zod';
import type { setupConfigSchema } from './config.js';

/** Parsed shape of `tooling/setup/setup.config.json` (see {@link setupConfigSchema}). */
export type SetupConfig = z.infer<typeof setupConfigSchema>;
