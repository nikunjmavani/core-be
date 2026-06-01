/**
 * Policy: every POST/PUT/PATCH route that accepts a JSON body must declare `schema.body`
 * (fastify-type-provider-zod). Empty-body and raw-body routes are allowlisted.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const DOMAINS_ROOT = join(PROJECT_ROOT, 'src/domains');

/** Route path fragments with no request body (action-only or cookie/header auth). */
const NO_BODY_ROUTE_PATH_ALLOWLIST = [
  '/logout',
  '/refresh',
  '/resend-verification',
  '/webauthn/register/options',
  '/me/sessions',
  '/me/data-export',
  '/suspend',
  '/unsuspend',
  '/confirm',
  '/leave',
  '/decline',
  '/cancel',
  '/resume',
  '/rotate',
  '/mark-all-read',
  '/read',
  '/webhooks/',
  '/test',
  '/webhook',
  '/stripe/webhook',
] as const;

const REGISTRAR_ONLY_ROUTE_FILES = new Set([
  'src/domains/billing/billing.routes.ts',
  'src/domains/tenancy/tenancy.routes.ts',
  'src/domains/notify/notify.routes.ts',
]);

function collectRouteFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectRouteFiles(fullPath, collected);
      continue;
    }
    if (entry.endsWith('.routes.ts')) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function relativePath(absolutePath: string): string {
  return absolutePath.replace(`${PROJECT_ROOT}/`, '');
}

function isNoBodyRoute(pathLiteral: string): boolean {
  return NO_BODY_ROUTE_PATH_ALLOWLIST.some((fragment) => pathLiteral.includes(fragment));
}

/**
 * Returns mutating route registrations missing `body:` in their options block.
 */
function findBodySchemaGaps(source: string, filePath: string): string[] {
  const gaps: string[] = [];
  const mutatingPattern = /\.(post|put|patch)\s*\(\s*(['"`])([^'"`]+)\2/g;

  for (const match of source.matchAll(mutatingPattern)) {
    const method = match[1];
    const pathLiteral = match[3];
    if (!(method && pathLiteral)) {
      continue;
    }
    if (isNoBodyRoute(pathLiteral)) {
      continue;
    }

    const routeStart = match.index ?? 0;
    const optionsStart = source.indexOf('{', routeStart);
    if (optionsStart === -1) {
      gaps.push(`${method.toUpperCase()} ${pathLiteral} (no options block)`);
      continue;
    }

    let depth = 0;
    let optionsEnd = -1;
    for (let index = optionsStart; index < source.length; index++) {
      const character = source[index];
      if (character === '{') {
        depth++;
      } else if (character === '}') {
        depth--;
        if (depth === 0) {
          optionsEnd = index;
          break;
        }
      }
    }

    const optionsBlock =
      optionsEnd === -1 ? source.slice(optionsStart) : source.slice(optionsStart, optionsEnd + 1);

    if (!optionsBlock.includes('body:')) {
      gaps.push(`${method.toUpperCase()} ${pathLiteral}`);
    }
  }

  if (gaps.length > 0) {
    return [`${filePath}: ${gaps.join(', ')}`];
  }
  return [];
}

describe('Zod route body boundary policy', () => {
  const routeFiles = collectRouteFiles(DOMAINS_ROOT);

  it('registers fastify-type-provider-zod globally', () => {
    const middlewareSource = readFileSync(
      join(PROJECT_ROOT, 'src/shared/middlewares/core/zod-type-provider.middleware.ts'),
      'utf8',
    );
    expect(middlewareSource).toContain('validatorCompiler');
    expect(middlewareSource).toContain('serializerCompiler');
  });

  it('uses withTypeProvider on every domain routes file that registers HTTP handlers', () => {
    const missingProvider: string[] = [];

    for (const absolutePath of routeFiles) {
      const relative = relativePath(absolutePath);
      if (REGISTRAR_ONLY_ROUTE_FILES.has(relative)) {
        continue;
      }

      const source = readFileSync(absolutePath, 'utf8');
      const registersHandlers = /\.(get|post|put|patch|delete)\s*\(/.test(source);
      if (!registersHandlers) {
        continue;
      }
      if (!source.includes('withTypeProvider')) {
        missingProvider.push(relative);
      }
    }

    expect(missingProvider).toEqual([]);
  });

  it('requires schema.body on POST/PUT/PATCH routes that accept a body', () => {
    const violations: string[] = [];

    for (const absolutePath of routeFiles) {
      const relative = relativePath(absolutePath);
      if (REGISTRAR_ONLY_ROUTE_FILES.has(relative)) {
        continue;
      }

      const source = readFileSync(absolutePath, 'utf8');
      violations.push(...findBodySchemaGaps(source, relative));
    }

    expect(violations).toEqual([]);
  });
});
