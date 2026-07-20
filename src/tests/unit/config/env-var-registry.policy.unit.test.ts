import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ENV_VAR_REGISTRY, envSchemaKeys } from '@/shared/config/env-schema.js';
import {
  type EnvVarSpec,
  buildEnvCatalog,
  envVar,
  toSchemaShape,
} from '@/shared/config/env-var-registry.js';
import { renderEnvCatalog } from '@tooling/env-registry/generate-catalog.js';

const budget = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tooling/env-registry/coverage-budget.json'), 'utf-8'),
) as { migrated: number };

describe('env-var-registry DSL', () => {
  it('envVar pairs the inline schema (unchanged) with allowed + description', () => {
    const spec = envVar(z.coerce.number().int().default(5), {
      allowed: 'integer',
      description: 'x',
    });
    expect(spec.allowed).toBe('integer');
    expect(spec.description).toBe('x');
    expect(spec.schema.parse(undefined)).toBe(5); // schema is carried verbatim
  });

  it('toSchemaShape derives the { key: schema } object for z.object()', () => {
    const registry = { A: envVar(z.string().default('a'), { allowed: 's', description: 'd' }) };
    expect(z.object(toSchemaShape(registry)).parse({}).A).toBe('a');
  });

  it('buildEnvCatalog reads default + required back from each Zod field', () => {
    const registry: Record<string, EnvVarSpec> = {
      WITH_DEFAULT: envVar(z.coerce.number().default(3000), { allowed: 'int', description: 'd' }),
      REQUIRED: envVar(z.string().min(1), { allowed: 'string', description: 'd' }),
      OPTIONAL: envVar(z.string().optional(), { allowed: 'string', description: 'd' }),
    };
    const rows = new Map(buildEnvCatalog(registry).map((row) => [row.name, row]));
    expect(rows.get('WITH_DEFAULT')).toMatchObject({ default: '3000', required: false });
    expect(rows.get('REQUIRED')).toMatchObject({ default: null, required: true });
    expect(rows.get('OPTIONAL')).toMatchObject({ default: null, required: false });
  });
});

describe('ENV_VAR_REGISTRY coverage + quality', () => {
  it('every entry has a non-empty allowed-values summary and description', () => {
    for (const [name, spec] of Object.entries(ENV_VAR_REGISTRY)) {
      expect(spec.allowed.trim(), `${name}.allowed must be non-empty`).not.toBe('');
      expect(spec.description.trim(), `${name}.description must be non-empty`).not.toBe('');
    }
  });

  it('every registry key is a real schema key (no typos or stale entries)', () => {
    const schemaKeys = new Set(envSchemaKeys as unknown as string[]);
    for (const name of Object.keys(ENV_VAR_REGISTRY)) {
      expect(schemaKeys.has(name), `${name} is not an env-schema key`).toBe(true);
    }
  });

  it('coverage only grows — registry size is at least the ratchet budget', () => {
    expect(Object.keys(ENV_VAR_REGISTRY).length).toBeGreaterThanOrEqual(budget.migrated);
  });

  it('docs/reference/env-catalog.md is in sync — run `pnpm env:catalog` after editing the registry', () => {
    const committed = readFileSync(
      resolve(process.cwd(), 'docs/reference/env-catalog.md'),
      'utf-8',
    );
    expect(renderEnvCatalog()).toBe(committed);
  });

  it('migrated fields keep their exact validation (byte-identical spot check)', () => {
    expect(ENV_VAR_REGISTRY.PORT?.schema.parse(undefined)).toBe(3000);
    expect(ENV_VAR_REGISTRY.LOG_LEVEL?.schema.parse(undefined)).toBe('info');
    expect(ENV_VAR_REGISTRY.HTTP_SERVER_TIMING_ENABLED?.schema.parse(undefined)).toBe(true);
    expect(() => ENV_VAR_REGISTRY.PORT?.schema.parse(99_999)).toThrow(); // max 65535 still enforced
  });
});
