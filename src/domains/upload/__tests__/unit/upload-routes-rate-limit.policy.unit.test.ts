import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Route-policy regression for the upload domain — the sibling of the files that already
 * pin auth, user, billing/subscription, tenancy/membership, and tenancy/organization.
 * Upload was the only routed domain without one, while all four of its routes issue or
 * revoke S3 work and therefore must stay capped:
 *
 *   POST /            → presigns an S3 URL (uncapped = free presign farm)
 *   GET  /:upload_id  → metadata read
 *   POST /:id/confirm → HEAD + server-side copy in S3
 *   DELETE /:upload_id → S3 delete
 *
 * Enforced textually against the route file rather than at runtime because Fastify's
 * per-route `config` is buried behind plugin encapsulation. The check is brace-balanced
 * rather than regex-terminated so a nested `schema: { ... }` block cannot truncate the
 * extracted options object and hide a dropped preset.
 */
describe('upload routes rate-limit + idempotency policy', () => {
  const uploadRoutesPath = join(process.cwd(), 'src/domains/upload/upload.routes.ts');
  const source = readFileSync(uploadRoutesPath, 'utf8');

  const RATE_LIMIT_PRESET = '...MODERATE_AUTHED_RATE_LIMIT';

  /**
   * Returns the full, brace-balanced route-options object for a registration.
   * Accepts both spread shapes in use: `...MODERATE_AUTHED_RATE_LIMIT` at the top level
   * and `config: { idempotencyRequired: true, ...MODERATE_AUTHED_RATE_LIMIT.config }`.
   */
  function findRouteOptions(httpMethod: string, urlLiteral: string): string {
    const escapedUrl = urlLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const header = new RegExp(`zodApplication\\.${httpMethod}\\(\\s*'${escapedUrl}',\\s*\\{`, 'm');
    const match = header.exec(source);
    if (!match) {
      throw new Error(`route registration not found: ${httpMethod.toUpperCase()} ${urlLiteral}`);
    }

    const openingBraceIndex = match.index + match[0].length - 1;
    let depth = 0;
    for (let index = openingBraceIndex; index < source.length; index += 1) {
      const character = source[index];
      if (character === '{') depth += 1;
      if (character === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(openingBraceIndex, index + 1);
      }
    }
    throw new Error(`unbalanced route options: ${httpMethod.toUpperCase()} ${urlLiteral}`);
  }

  it('POST / has MODERATE_AUTHED_RATE_LIMIT applied (presign issues an S3 URL)', () => {
    expect(findRouteOptions('post', '/')).toContain(RATE_LIMIT_PRESET);
  });

  it('GET /:upload_id has MODERATE_AUTHED_RATE_LIMIT applied', () => {
    expect(findRouteOptions('get', '/:upload_id')).toContain(RATE_LIMIT_PRESET);
  });

  it('POST /:upload_id/confirm has MODERATE_AUTHED_RATE_LIMIT applied (S3 HEAD + copy)', () => {
    expect(findRouteOptions('post', '/:upload_id/confirm')).toContain(RATE_LIMIT_PRESET);
  });

  it('DELETE /:upload_id has MODERATE_AUTHED_RATE_LIMIT applied (S3 delete)', () => {
    expect(findRouteOptions('delete', '/:upload_id')).toContain(RATE_LIMIT_PRESET);
  });

  /**
   * `POST /uploads` is one of the `idempotencyRequired` writes listed in the `I` column of
   * docs/routes.txt: without a key a retried presign mints a second PENDING row (and burns a
   * second slot against the per-user / per-organization PENDING quota) for one client intent.
   */
  it('POST / declares idempotencyRequired: true', () => {
    expect(findRouteOptions('post', '/')).toContain('idempotencyRequired: true');
  });

  /**
   * The converse half of the same policy: confirm and delete are declared idempotent by their
   * own semantics (re-confirming an UPLOADED row succeeds, deleting a deleted row 404s), so
   * requiring a key on them would only break clients. Pinned so a blanket "add idempotency to
   * every upload write" refactor has to be a deliberate, documented change to the `I` column.
   */
  it('no other upload route declares idempotencyRequired', () => {
    const otherRoutes: Array<[string, string]> = [
      ['get', '/:upload_id'],
      ['post', '/:upload_id/confirm'],
      ['delete', '/:upload_id'],
    ];
    for (const [httpMethod, urlLiteral] of otherRoutes) {
      expect(findRouteOptions(httpMethod, urlLiteral)).not.toContain('idempotencyRequired');
    }
  });
});
