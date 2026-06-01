/**
 * Faker-based payloads for full seed. Used only by scripts/seed (orchestration).
 * Reproducible via SEED env or default 12345.
 */
import { faker } from '@faker-js/faker';

const SEED = Number(process.env.SEED) || 12_345;

/** Pins faker to the SEED env (defaults to 12345) so full-seed runs are reproducible. */
export function initFakerSeed(): void {
  faker.seed(SEED);
}

/** Shape for a fake user inserted by the full seed (matches `auth.users` columns). */
export interface FakerUserPayload {
  email: string;
  first_name: string;
  last_name: string;
}

/** Builds a deterministic fake user payload; `overrides` win over generated values. */
export function generateUserPayload(overrides?: Partial<FakerUserPayload>): FakerUserPayload {
  const first = faker.person.firstName();
  const last = faker.person.lastName();
  return {
    email:
      overrides?.email ?? faker.internet.email({ firstName: first, lastName: last }).toLowerCase(),
    first_name: overrides?.first_name ?? first,
    last_name: overrides?.last_name ?? last,
  };
}

/** Shape for a fake organization inserted by the full seed (matches `tenancy.organizations`). */
export interface FakerOrganizationPayload {
  name: string;
  slug: string;
}

const usedSlugs = new Set<string>();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Builds a fake organization payload with a slug that is unique within the
 * current process; collisions get a 5-char alphanumeric suffix.
 */
export function generateOrganizationPayload(
  overrides?: Partial<FakerOrganizationPayload>,
): FakerOrganizationPayload {
  const name = overrides?.name ?? faker.company.name();
  let slug = overrides?.slug ?? slugify(name);
  while (usedSlugs.has(slug)) {
    slug = `${slug}-${faker.string.alphanumeric(5).toLowerCase()}`;
  }
  usedSlugs.add(slug);
  return { name, slug };
}

/** Returns a lowercase email for an invitee row in the full seed. */
export function generateInviteeEmail(): string {
  return faker.internet.email().toLowerCase();
}
