import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard — seed public-id entity prefixes.
 *
 * Public ids are Paddle-style `<prefix>_<21>` minted by `generatePublicId(entity)`,
 * where the entity selects the prefix (`memberRole`→`rol_`, `membership`→`mem_`,
 * `memberInvitation`→`inv_`, `organization`→`org_`). A copy-paste bug had the
 * tenancy seed helpers `seedRole` / `seedMembership` / `seedMemberInvitation` all
 * pass `'organization'`, so seeded rows carried `org_`-prefixed ids. That silently
 * broke the frontend's typed-id contract (`role_id: publicId('rol')`), dropping
 * seeded members from the members list.
 *
 * This scans the source (rather than running the DB seed, which the standalone
 * `runFullSeed` orchestrator is not structured for inside Vitest) and pins each
 * seed helper to the entity it MUST mint — a fast, deterministic tripwire for the
 * exact copy-paste class of regression.
 */
describe('Global: tenancy seed public-id entities', () => {
  const SEED_PATH = 'src/domains/tenancy/seed/tenancy.seed.ts';
  const source = readFileSync(resolve(process.cwd(), SEED_PATH), 'utf8');

  /** Each seed helper → the single `generatePublicId` entity it is allowed to mint. */
  const HELPER_ENTITY = [
    { helper: 'seedOrganization', entity: 'organization' },
    { helper: 'seedRole', entity: 'memberRole' },
    { helper: 'seedMembership', entity: 'membership' },
    { helper: 'seedMemberInvitation', entity: 'memberInvitation' },
  ] as const;

  /** The slice of source from a helper's declaration up to the next top-level function. */
  function bodyOf(helper: string): string {
    const marker = `export async function ${helper}(`;
    const start = source.indexOf(marker);
    expect(start, `${helper} not found in ${SEED_PATH}`).toBeGreaterThanOrEqual(0);
    const next = source.indexOf('export async function ', start + marker.length);
    return next === -1 ? source.slice(start) : source.slice(start, next);
  }

  it.each(
    HELPER_ENTITY,
  )('$helper mints its public_id with the $entity entity (never another entity)', ({
    helper,
    entity,
  }) => {
    const body = bodyOf(helper);
    expect(body, `${helper} must call generatePublicId('${entity}')`).toContain(
      `generatePublicId('${entity}')`,
    );
    for (const other of HELPER_ENTITY) {
      if (other.entity === entity) continue;
      expect(body, `${helper} must not mint a ${other.entity} id`).not.toContain(
        `generatePublicId('${other.entity}')`,
      );
    }
  });
});
