/**
 * Bootstrap local `.env.<environment>` files from the canonical `.env.example`.
 *
 * The structure of `.env.example` already encodes everything:
 *
 *   # ######################
 *   # GitHub Secrets — …
 *   # ######################
 *
 *   # --- Database (Postgres) ---
 *   DATABASE_URL=…
 *
 *   # ######################
 *   # GitHub Variables — …
 *   # ######################
 *
 *   # --- Server & process ---
 *   PORT=3000
 *   …
 *
 * Init copies `.env.example` verbatim — including sub-section headers and
 * per-key description comments — into `.env.<environment>`, swapping only:
 *   1. The top intro banner (replaced with an env-specific one).
 *   2. The `NODE_ENV=` value (set to the environment name).
 *
 * Keeping descriptions inline means a `diff .env.example .env.<environment>`
 * shows ONLY value differences, never structural drift. `pnpm env:sync`
 * reads the same structure and pushes secrets/variables accordingly; the
 * sync parser already ignores comment lines, so the descriptions are inert.
 *
 * Usage:
 *   pnpm env:init                          # defaults: development + production
 *   pnpm env:init staging
 *   pnpm env:init development production staging
 *   pnpm env:init --force                  # overwrite existing files
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { envSchemaKeys } from '@/shared/config/env-schema.js';

import { parseEnvExampleSections } from './parse-env-example-sections.js';

const projectRoot = process.cwd();
const envExamplePath = resolve(projectRoot, '.env.example');

const DEFAULT_ENVIRONMENTS = ['development', 'production'] as const;

interface ParsedArguments {
  readonly environments: string[];
  readonly force: boolean;
}

function parseArguments(argv: string[]): ParsedArguments {
  const positional: string[] = [];
  let force = false;
  for (const arg of argv) {
    if (arg === '--force' || arg === '-f') {
      force = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: pnpm env:init [environment...] [--force]');
      console.log('');
      console.log('  environments  One or more env names (defaults: development, production)');
      console.log('  --force       Overwrite existing .env.<environment> files');
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(arg)) {
      console.error(`Invalid environment name "${arg}". Use lowercase letters, digits, dashes.`);
      process.exit(2);
    }
    positional.push(arg);
  }
  return {
    environments: positional.length > 0 ? positional : [...DEFAULT_ENVIRONMENTS],
    force,
  };
}

const TOP_BANNER_LINE = /^#\s=+\s*$/;
const HALF_BANNER_LINE = /^#\s#{3,}\s*$/;
const NODE_ENV_LINE = /^NODE_ENV=.*$/m;

/**
 * Replace the top intro banner of `.env.example` with an env-specific header
 * while preserving every sub-section header, per-key description, and trailing
 * note in the file. Everything from the first `# ###...###` half banner
 * onwards is copied verbatim so a line-by-line diff against the template
 * surfaces only value differences.
 */
function buildEnvironmentFile(environment: string, exampleContent: string): string {
  const lines = exampleContent.split('\n');

  // The first `# ###...###` line marks the start of the body (GitHub Secrets
  // half). Everything before it is the intro banner that needs swapping.
  const bodyStartIndex = lines.findIndex((line) => HALF_BANNER_LINE.test(line));
  if (bodyStartIndex === -1) {
    throw new Error(
      'Cannot find a `# ###...###` half banner in .env.example. The template appears malformed.',
    );
  }

  // Sanity check: the intro block we are about to drop should be framed by
  // `# ===...===` lines. If it is not, the template structure changed and a
  // human should review before this script silently rewrites it.
  const introBlock = lines.slice(0, bodyStartIndex);
  const equalsBanners = introBlock.filter((line) => TOP_BANNER_LINE.test(line)).length;
  if (equalsBanners === 0) {
    throw new Error(
      'No `# ===...===` banner found before the first half banner in .env.example. Refusing to overwrite an unrecognised intro block.',
    );
  }

  const envHeader = [
    '# =============================================================================',
    `# Environment file for "${environment}"`,
    '# =============================================================================',
    '#',
    '# This file is a verbatim mirror of .env.example with descriptions preserved,',
    '# so `diff .env.example .env.' + environment + '` surfaces only value drift.',
    '#',
    '# Edit values below, then push to the matching GitHub Environment with:',
    `#   pnpm env:sync ${environment}`,
    '#',
    '# Source template: .env.example (committed, documented).',
    '# Section IS classification — anything under "GitHub Secrets" is pushed as a',
    '# repository secret; anything under "GitHub Variables" is pushed as a variable.',
    '#',
    '# Regenerate (wipes local edits): pnpm env:init --force',
    '# =============================================================================',
    '',
  ];

  const body = lines.slice(bodyStartIndex);
  const merged = [...envHeader, ...body].join('\n');

  // Swap NODE_ENV value to the target environment (single, exact match).
  return merged.replace(NODE_ENV_LINE, `NODE_ENV=${environment}`);
}

function main(): void {
  const { environments, force } = parseArguments(process.argv.slice(2));

  if (!existsSync(envExamplePath)) {
    console.error('Cannot find .env.example at the repo root.');
    process.exit(1);
  }

  const parsed = parseEnvExampleSections(envExamplePath);
  const exampleKeys = new Set<string>();
  for (const half of [parsed.secrets, parsed.variables]) {
    for (const subSection of half.subSections) {
      for (const key of subSection.keys) exampleKeys.add(key.name);
    }
  }

  // Sanity check — every schema key must appear in .env.example.
  const missing = envSchemaKeys.filter((key) => !exampleKeys.has(key));
  if (missing.length > 0) {
    console.error(
      `.env.example is missing ${missing.length} schema key(s): ${missing.join(', ')}`,
    );
    console.error('Run `pnpm tool:sync-env-example --fix` to repair.');
    process.exit(1);
  }

  const secretCount = parsed.secrets.subSections.reduce((n, s) => n + s.keys.length, 0);
  const variableCount = parsed.variables.subSections.reduce((n, s) => n + s.keys.length, 0);
  const exampleContent = readFileSync(envExamplePath, 'utf-8');

  console.log(`Source:        .env.example`);
  console.log(`Secrets:       ${secretCount} keys (${parsed.secrets.subSections.length} sub-sections)`);
  console.log(`Variables:     ${variableCount} keys (${parsed.variables.subSections.length} sub-sections)`);
  console.log(`Environments:  ${environments.join(', ')}`);
  console.log('');

  let created = 0;
  let skipped = 0;
  for (const environment of environments) {
    const targetPath = resolve(projectRoot, `.env.${environment}`);
    if (existsSync(targetPath) && !force) {
      console.log(`  skip   .env.${environment} (exists; pass --force to overwrite)`);
      skipped += 1;
      continue;
    }
    writeFileSync(targetPath, buildEnvironmentFile(environment, exampleContent), 'utf-8');
    console.log(`  create .env.${environment}`);
    created += 1;
  }

  console.log('');
  console.log(`Done. Created ${created}, skipped ${skipped}.`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit each .env.<environment> with real values.');
  console.log('  2. Run `pnpm env:sync <environment>` to push to the matching GitHub Environment.');
  console.log('  3. Local dev: `pnpm dev` (loads .env.development by default).');
}

main();
