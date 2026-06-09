/**
 * Detects zombie / drifted keys in `.env.<environment>` files.
 *
 * `.env.example` is the single committed template — every key the runtime uses
 * MUST appear there. Per-environment `.env.<name>` files are gitignored copies
 * populated by ops (and the source of truth `pnpm github:sync` pushes to
 * GitHub Environments). When a key is removed from `.env.example` and the
 * schema (e.g. sec-C5 retired `JWT_SECRET` for RS256-only auth) but lingers
 * in `.env.<name>`, the sync silently pushes it to GitHub. The runtime
 * ignores it, but it sits there as a confusing zombie credential.
 *
 * This guard walks every `.env.<environment>` file present locally and fails
 * if any key in those files is NOT in `.env.example`. Companion to
 * `pnpm tool:sync-env-example`, which validates `.env.example` against the
 * Zod schema. Together they enforce:
 *
 *   schema (env-schema.ts)  ⇔  .env.example  ⇔  .env.<env>
 *
 * Usage:
 *   pnpm tool:check-env-drift            # exit 1 on any zombie key
 *   pnpm tool:check-env-drift --warn     # log but always exit 0 (CI-soft mode)
 *
 * Failure mode: no `.env.<env>` files exist → succeed silently (fresh clones).
 * Files with malformed lines are still parsed line-by-line; only `KEY=value`
 * entries are extracted, so comments and blanks are ignored.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '../../../..');

/**
 * Maps each gitignored env file name to the committed template that defines
 * its allowed key set. Runtime env files (`.env.<environment>`) are bounded
 * by `.env.example`. Setup-time provisioning files (`.env.setup`,
 * `.env.setup.<environment>`) are bounded by `.env.setup.example` — that's
 * a different template for credentials that `tooling/setup/` uses to
 * provision Neon/AWS/Railway/etc., not for the API/worker runtime.
 *
 * `.env.local` is intentionally NOT validated: it's a per-developer override
 * that can legitimately contain machine-specific keys (e.g. local debug
 * tooling) that don't belong in either template.
 */
function resolveTemplateFor(envFileName: string): string | null {
  if (envFileName === '.env.example' || envFileName === '.env.setup.example') return null;
  if (envFileName === '.env.local') return null;
  if (envFileName === '.env.setup' || envFileName.startsWith('.env.setup.')) {
    return resolve(projectRoot, '.env.setup.example');
  }
  if (envFileName.startsWith('.env.')) {
    return resolve(projectRoot, '.env.example');
  }
  return null;
}

const WARN_ONLY = process.argv.includes('--warn');

/**
 * Extracts uncommented `KEY=` names from an env file's text. Mirrors the
 * accepted key syntax in `sync-env-example.ts` (upper-snake, starts with a
 * letter). Comments, blanks, and continuation lines are ignored.
 */
function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  const keyRegex = /^([A-Z][A-Z0-9_]*)\s*=/;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const match = trimmed.match(keyRegex);
    if (match) keys.add(match[1]!);
  }
  return keys;
}

/**
 * Lists every `.env.*` file in the repo root paired with its committed
 * template (per {@link resolveTemplateFor}). Files that map to no template
 * (`.env.example`, `.env.setup.example`, `.env.local`) are excluded.
 */
function findEnvFileTemplatePairs(): Array<{ envFile: string; template: string }> {
  const out: Array<{ envFile: string; template: string }> = [];
  let entries: string[];
  try {
    entries = readdirSync(projectRoot);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.startsWith('.env.')) continue;
    const template = resolveTemplateFor(entry);
    if (template === null) continue;
    out.push({ envFile: resolve(projectRoot, entry), template });
  }
  return out;
}

function main(): void {
  const pairs = findEnvFileTemplatePairs();
  if (pairs.length === 0) {
    console.log('No `.env.<environment>` files present locally — nothing to drift-check.');
    process.exit(0);
  }

  // Cache parsed template key sets across env files that share a template.
  const templateKeyCache = new Map<string, Set<string>>();
  function getTemplateKeys(templatePath: string): Set<string> | null {
    let cached = templateKeyCache.get(templatePath);
    if (cached !== undefined) return cached;
    if (!existsSync(templatePath)) {
      console.error(`Template missing: ${templatePath.replace(`${projectRoot}/`, '')}`);
      return null;
    }
    cached = parseEnvKeys(readFileSync(templatePath, 'utf-8'));
    templateKeyCache.set(templatePath, cached);
    return cached;
  }

  let totalDrift = 0;
  const driftReport: Array<{ file: string; template: string; key: string }> = [];

  for (const { envFile, template } of pairs) {
    const templateKeys = getTemplateKeys(template);
    if (templateKeys === null) {
      process.exit(1);
    }
    const envKeys = parseEnvKeys(readFileSync(envFile, 'utf-8'));
    for (const key of envKeys) {
      if (!templateKeys.has(key)) {
        driftReport.push({
          file: envFile.replace(`${projectRoot}/`, ''),
          template: template.replace(`${projectRoot}/`, ''),
          key,
        });
        totalDrift += 1;
      }
    }
  }

  if (totalDrift === 0) {
    console.log(
      `✓ No zombie keys — every key in ${pairs.length} local env file(s) is present in its committed template.`,
    );
    process.exit(0);
  }

  console.error('');
  console.error(
    `✗ Zombie key drift detected: ${totalDrift} key(s) live in local env files but are NOT in their committed template.`,
  );
  console.error('');
  for (const { file, template, key } of driftReport) {
    console.error(`  ${file}  →  ${key}   (template: ${template})`);
  }
  console.error('');
  console.error('Fix options:');
  console.error('  1. The key is still needed → add it to .env.example AND env-schema.ts.');
  console.error('  2. The key was retired    → remove its line from the .env.<env> file(s),');
  console.error('                             and delete it from the matching GitHub Environment:');
  console.error(
    '                             gh api -X DELETE repos/<org>/<repo>/environments/<env>/secrets/<KEY>',
  );
  console.error(
    '                             gh api -X DELETE repos/<org>/<repo>/environments/<env>/variables/<KEY>',
  );
  console.error('');
  console.error('Background: a zombie key gets pushed by `pnpm github:sync` even though the');
  console.error('runtime ignores it, leaving an unused credential in the GitHub Environment.');
  console.error('See docs/integrations/credentials-and-env.md.');

  process.exit(WARN_ONLY ? 0 : 1);
}

main();
