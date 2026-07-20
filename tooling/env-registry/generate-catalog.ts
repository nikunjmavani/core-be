/**
 * Generates `docs/reference/env-catalog.md` — the per-variable catalog of allowed values, default,
 * required/optional status, and description — from `ENV_VAR_REGISTRY` + the env schema.
 *
 * @remarks
 * The registry (`src/shared/config/env-schema.ts`) is the source for allowed-values + description;
 * the default and required status are read from the Zod field via the public API, so the catalog can
 * never disagree with what boots. Run `pnpm env:catalog` to regenerate, `pnpm env:catalog:check` to
 * verify it is in sync (CI gate). The doc is committed so it is reviewable in diffs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ENV_VAR_REGISTRY,
  envSchemaDefaults,
  envSchemaKeys,
  envSchemaRequiredKeys,
} from '@/shared/config/env-schema.js';
import { buildEnvCatalog } from '@/shared/config/env-var-registry.js';

const OUTPUT_PATH = resolve(process.cwd(), 'docs/reference/env-catalog.md');

const escapeCell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Renders the full catalog Markdown from the registry + schema. */
export function renderEnvCatalog(): string {
  const registryRows = new Map(buildEnvCatalog(ENV_VAR_REGISTRY).map((row) => [row.name, row]));
  const required = new Set<string>(envSchemaRequiredKeys);
  const keys = [...(envSchemaKeys as unknown as string[])].sort((a, b) => a.localeCompare(b));

  const tableRows = keys.map((name) => {
    const registered = registryRows.get(name);
    const schemaDefault = envSchemaDefaults[name];
    const defaultCell =
      schemaDefault !== undefined
        ? `\`${schemaDefault}\``
        : required.has(name)
          ? '— *(required)*'
          : '— *(optional)*';
    return `| \`${name}\` | ${escapeCell(registered?.allowed ?? '—')} | ${defaultCell} | ${registered ? '✓' : ''} | ${escapeCell(registered?.description ?? '—')} |`;
  });

  return [
    '# Environment variable catalog',
    '',
    '> **Generated** by `pnpm env:catalog` from `ENV_VAR_REGISTRY` + the env schema. Do not edit by hand.',
    '> `pnpm env:catalog:check` verifies it is in sync (CI gate).',
    '',
    `Allowed values + description come from the explicit registry; the **default** and **required/optional**`,
    `status are read from each Zod field, so this can never disagree with what boots. Registry coverage:`,
    `**${registryRows.size} / ${keys.length}** variables migrated to an explicit \`{ allowed, description }\` entry.`,
    '',
    '| Variable | Allowed values | Default | In registry | Description |',
    '| --- | --- | --- | :---: | --- |',
    ...tableRows,
    '',
  ].join('\n');
}

function main(): void {
  const check = process.argv.includes('--check');
  const rendered = renderEnvCatalog();
  if (check) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf-8') : '';
    if (current !== rendered) {
      console.error(
        'docs/reference/env-catalog.md is out of date. Run `pnpm env:catalog` and commit the result.',
      );
      process.exit(1);
    }
    console.log('env-catalog.md is in sync.');
    return;
  }
  writeFileSync(OUTPUT_PATH, rendered, 'utf-8');
  console.log(`Wrote ${OUTPUT_PATH}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
