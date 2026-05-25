/**
 * Sync .env.example → each .env.<environment> file.
 *
 * New files are created from the .env.example template with provisioned values.
 * Existing files are regenerated — provisioned keys get fresh values from state,
 * non-provisioned keys keep their existing values (preserving user edits).
 * Missing keys from .env.example are automatically added in the correct sections.
 *
 * Usage:
 *   pnpm envs:sync:local
 */

import { runExportEnv } from './export-env-files.js';

runExportEnv();
