import { and, asc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { users as authUsers } from '@/domains/user/user.schema.js';
import { BaseRepository } from '@/infrastructure/database/base-repository.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import {
  buildAscendingCreatedAtIdCursorCondition,
  createOpaqueCursorFromRow,
  parseListCursor,
} from '@/shared/utils/http/pagination.util.js';
import type { Organization } from './organization.types.js';

interface OrganizationListPagination {
  after?: string;
  limit: number;
}

/**
 * Drizzle data-access for the `tenancy.organizations` table. Honours
 * soft-delete (`deleted_at IS NULL`) on every read; supports cursor-based
 * listings (global and per-user via memberships join), slug + Stripe customer
 * lookups, owner transfer, and soft-delete. Insert paths use
 * {@link runInsertWithPublicIdentifierRetry} to recover from rare public-id
 * collisions.
 */
export class OrganizationRepository extends BaseRepository {
  async resolveUserIdByPublicId(public_id: string | undefined): Promise<number | null> {
    if (!public_id) return null;
    const rows = await getRequestDatabase()
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(and(eq(authUsers.public_id, public_id), isNull(authUsers.deleted_at)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async resolveUserPublicIdByInternalId(user_id: number): Promise<string | null> {
    const rows = await getRequestDatabase()
      .select({ public_id: authUsers.public_id })
      .from(authUsers)
      .where(and(eq(authUsers.id, user_id), isNull(authUsers.deleted_at)))
      .limit(1);
    return rows[0]?.public_id ?? null;
  }

  async findById(identifier: number): Promise<Organization | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, identifier), isNull(organizations.deleted_at)))
      .limit(1);
    return (rows[0] ?? null) as Organization | null;
  }

  async findByPublicId(public_id: string): Promise<Organization | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(organizations)
      .where(and(eq(organizations.public_id, public_id), isNull(organizations.deleted_at)))
      .limit(1);
    return (rows[0] ?? null) as Organization | null;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(organizations)
      .where(and(eq(organizations.slug, slug), isNull(organizations.deleted_at)))
      .limit(1);
    return (rows[0] ?? null) as Organization | null;
  }

  async findAll(pagination: OrganizationListPagination, _owner_user_id?: number) {
    const { after, limit } = pagination;
    const cursorCondition = buildAscendingCreatedAtIdCursorCondition(
      organizations.created_at,
      organizations.id,
      parseListCursor(after),
    );
    const where = and(isNull(organizations.deleted_at), cursorCondition);
    const rows = await getRequestDatabase()
      .select()
      .from(organizations)
      .where(where)
      .orderBy(asc(organizations.created_at), asc(organizations.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows) as Organization[];
    const lastItem = items.at(-1);
    return {
      items,
      total: null,
      limit,
      has_more: hasMore,
      next_cursor: hasMore && lastItem !== undefined ? createOpaqueCursorFromRow(lastItem) : null,
    };
  }

  async findAllForUser(user_public_id: string, pagination: OrganizationListPagination) {
    const { after, limit } = pagination;
    const userId = await this.resolveUserIdByPublicId(user_public_id);
    if (userId === null) {
      return {
        items: [],
        total: null,
        limit,
        has_more: false,
        next_cursor: null,
      };
    }
    const cursorCondition = buildAscendingCreatedAtIdCursorCondition(
      organizations.created_at,
      organizations.id,
      parseListCursor(after),
    );
    const accessWhere = and(
      isNull(organizations.deleted_at),
      cursorCondition,
      or(
        eq(organizations.owner_user_id, userId),
        and(
          eq(memberships.user_id, userId),
          eq(memberships.status, 'ACTIVE'),
          isNull(memberships.deleted_at),
        ),
      ),
    );
    const rows = await getRequestDatabase()
      .select()
      .from(organizations)
      .leftJoin(
        memberships,
        and(
          eq(memberships.organization_id, organizations.id),
          eq(memberships.user_id, userId),
          eq(memberships.status, 'ACTIVE'),
          isNull(memberships.deleted_at),
        ),
      )
      .where(accessWhere)
      .orderBy(asc(organizations.created_at), asc(organizations.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const organizationsOnly = pageRows.map((row) => row.organizations);
    const lastItem = organizationsOnly.at(-1);
    return {
      items: organizationsOnly,
      total: null,
      limit,
      has_more: hasMore,
      next_cursor: hasMore && lastItem !== undefined ? createOpaqueCursorFromRow(lastItem) : null,
    };
  }

  async userCanAccessOrganization(
    user_public_id: string,
    organization_public_id: string,
  ): Promise<boolean> {
    const organization = await this.findByPublicId(organization_public_id);
    if (!organization) {
      return false;
    }
    const userId = await this.resolveUserIdByPublicId(user_public_id);
    if (userId !== null && organization.owner_user_id === userId) {
      return true;
    }
    return this.userHasActiveMembership(user_public_id, organization_public_id);
  }

  async userHasActiveMembership(
    user_public_id: string,
    organization_public_id: string,
  ): Promise<boolean> {
    const rows = await getRequestDatabase()
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(authUsers, eq(memberships.user_id, authUsers.id))
      .innerJoin(organizations, eq(memberships.organization_id, organizations.id))
      .where(
        and(
          eq(authUsers.public_id, user_public_id),
          eq(organizations.public_id, organization_public_id),
          eq(memberships.status, 'ACTIVE'),
          isNull(memberships.deleted_at),
          isNull(organizations.deleted_at),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async create(data: {
    name: string;
    slug: string;
    owner_user_id: number;
    created_by_user_id: number | null;
  }) {
    return runInsertWithPublicIdentifierRetry(async () => {
      const public_id = generatePublicId();
      const row = {
        public_id,
        name: data.name,
        slug: data.slug,
        owner_user_id: data.owner_user_id,
        created_by_user_id: data.created_by_user_id ?? undefined,
        updated_by_user_id: data.created_by_user_id ?? undefined,
      };
      const rows = await getRequestDatabase().insert(organizations).values(row).returning();
      return rows[0]! as Organization;
    });
  }

  async update(
    public_id: string,
    data: { name?: string; slug?: string; status?: string; logo_url?: string | null },
    updated_by_user_id: number | null,
  ): Promise<Organization | null> {
    const rows = await getRequestDatabase()
      .update(organizations)
      .set({
        ...data,
        updated_at: databaseNowTimestamp,
        updated_by_user_id: updated_by_user_id ?? undefined,
      })
      .where(and(eq(organizations.public_id, public_id), isNull(organizations.deleted_at)))
      .returning();
    return (rows[0] ?? null) as Organization | null;
  }

  async updateOwner(public_id: string, owner_user_id: number): Promise<Organization | null> {
    const rows = await getRequestDatabase()
      .update(organizations)
      .set({
        owner_user_id,
        updated_at: databaseNowTimestamp,
      })
      .where(
        and(
          eq(organizations.public_id, public_id),
          isNull(organizations.deleted_at),
          // Atomic guard against the transfer-ownership TOCTOU: only hand ownership to a user who
          // is STILL an active member at write time. If a concurrent request suspends or removes
          // the prospective owner between the caller's status pre-check and this update, the EXISTS
          // fails, the UPDATE matches zero rows, and the caller surfaces a clean conflict — so the
          // org can never end up owned by a suspended/removed member.
          sql`EXISTS (
            SELECT 1 FROM ${memberships}
            WHERE ${memberships.user_id} = ${owner_user_id}
              AND ${memberships.organization_id} = ${organizations.id}
              AND ${memberships.status} = 'ACTIVE'
              AND ${memberships.deleted_at} IS NULL
          )`,
        ),
      )
      .returning();
    return (rows[0] ?? null) as Organization | null;
  }

  async updateStripeCustomerId(
    organization_id: number,
    stripe_customer_id: string,
  ): Promise<Organization | null> {
    const rows = await getRequestDatabase()
      .update(organizations)
      .set({
        stripe_customer_id,
        updated_at: databaseNowTimestamp,
      })
      .where(eq(organizations.id, organization_id))
      .returning();
    return (rows[0] ?? null) as Organization | null;
  }

  async findByStripeCustomerId(stripe_customer_id: string): Promise<Organization | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(organizations)
      .where(
        and(
          eq(organizations.stripe_customer_id, stripe_customer_id),
          isNull(organizations.deleted_at),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as Organization | null;
  }

  async markDeletionStarted(public_id: string): Promise<Organization | null> {
    const rows = await getRequestDatabase()
      .update(organizations)
      .set({ deletion_started_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(and(eq(organizations.public_id, public_id), isNull(organizations.deleted_at)))
      .returning();
    return (rows[0] ?? null) as Organization | null;
  }

  async softDelete(public_id: string): Promise<Organization | null> {
    const rows = await getRequestDatabase()
      .update(organizations)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(
        and(
          eq(organizations.public_id, public_id),
          isNull(organizations.deleted_at),
          isNotNull(organizations.deletion_started_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as Organization | null;
  }
}
