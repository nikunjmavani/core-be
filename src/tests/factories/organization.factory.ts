import { faker } from '@faker-js/faker';
import { database } from '@/infrastructure/database/connection.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

export interface CreateOrganizationOptions {
  name?: string;
  slug?: string;
  ownerUserId: number;
}

/**
 * Create a test organization in the database.
 */
export async function createTestOrganization(options: CreateOrganizationOptions) {
  const publicId = generatePublicId();
  const name = options.name ?? faker.company.name();
  const slug = options.slug ?? faker.helpers.slugify(name).toLowerCase().slice(0, 50);

  const [organization] = await database
    .insert(organizations)
    .values({
      public_id: publicId,
      name,
      slug,
      owner_user_id: options.ownerUserId,
      created_by_user_id: options.ownerUserId,
    })
    .returning();

  return organization!;
}
