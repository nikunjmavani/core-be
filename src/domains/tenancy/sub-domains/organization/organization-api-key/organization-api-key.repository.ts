import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { api_keys } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.schema.js';
import { BaseRepository } from '@/infrastructure/database/base-repository.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import {
  buildAscendingCreatedAtIdCursorCondition,
  createOpaqueCursorFromRow,
  parseListCursor,
} from '@/shared/utils/http/pagination.util.js';
import type { OrganizationApiKeyRow } from './organization-api-key.types.js';

interface OrganizationApiKeyListPagination {
  after?: string;
  offset_page?: number;
  limit: number;
}

function parseScopesColumn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export class OrganizationApiKeyRepository extends BaseRepository {
  async findByOrganizationId(
    organization_id: number,
    pagination: OrganizationApiKeyListPagination,
  ) {
    const { after, offset_page, limit } = pagination;
    const cursorCondition =
      offset_page === undefined
        ? buildAscendingCreatedAtIdCursorCondition(
            api_keys.created_at,
            api_keys.id,
            parseListCursor(after),
          )
        : undefined;
    const where = and(
      eq(api_keys.organization_id, organization_id),
      isNull(api_keys.deleted_at),
      cursorCondition,
    );
    const rowsQuery = getRequestDatabase()
      .select()
      .from(api_keys)
      .where(where)
      .orderBy(asc(api_keys.created_at), asc(api_keys.id))
      .limit(limit + 1);
    const [rows, countResult] = await Promise.all([
      offset_page !== undefined ? rowsQuery.offset((offset_page - 1) * limit) : rowsQuery,
      offset_page !== undefined
        ? getRequestDatabase().select({ count: count() }).from(api_keys).where(where)
        : Promise.resolve([{ count: null }]),
    ]);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows) as OrganizationApiKeyRow[];
    const lastItem = items.at(-1);
    return {
      items,
      total: countResult[0]?.count ?? null,
      page: offset_page,
      limit,
      has_more: hasMore,
      next_cursor: hasMore && lastItem !== undefined ? createOpaqueCursorFromRow(lastItem) : null,
    };
  }

  async findByPublicId(
    public_id: string,
    organization_id: number,
  ): Promise<OrganizationApiKeyRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(api_keys)
      .where(
        and(
          eq(api_keys.public_id, public_id),
          eq(api_keys.organization_id, organization_id),
          isNull(api_keys.deleted_at),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as OrganizationApiKeyRow | null;
  }

  async create(data: {
    organization_id: number;
    name: string;
    key_hash: string;
    key_prefix: string;
    scopes: string[];
    expires_at?: Date | null;
    created_by_user_id?: number | null;
  }) {
    return runInsertWithPublicIdentifierRetry(async () => {
      const public_id = generatePublicId();
      const row = {
        public_id,
        organization_id: data.organization_id,
        name: data.name,
        key_hash: data.key_hash,
        key_prefix: data.key_prefix,
        scopes: data.scopes,
        expires_at: data.expires_at ?? undefined,
        created_by_user_id: data.created_by_user_id ?? undefined,
        updated_by_user_id: data.created_by_user_id ?? undefined,
      };
      const rows = await getRequestDatabase().insert(api_keys).values(row).returning();
      const inserted = rows[0]!;
      return {
        ...(inserted as OrganizationApiKeyRow),
        scopes: parseScopesColumn((inserted as { scopes?: unknown }).scopes),
      };
    });
  }

  async update(
    public_id: string,
    organization_id: number,
    data: { name?: string; status?: string },
    updated_by_user_id: number | null,
  ): Promise<OrganizationApiKeyRow | null> {
    const rows = await getRequestDatabase()
      .update(api_keys)
      .set({
        ...data,
        updated_at: databaseNowTimestamp,
        updated_by_user_id: updated_by_user_id ?? undefined,
      })
      .where(
        and(
          eq(api_keys.public_id, public_id),
          eq(api_keys.organization_id, organization_id),
          isNull(api_keys.deleted_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as OrganizationApiKeyRow | null;
  }

  async softDelete(
    public_id: string,
    organization_id: number,
  ): Promise<OrganizationApiKeyRow | null> {
    const rows = await getRequestDatabase()
      .update(api_keys)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(
        and(
          eq(api_keys.public_id, public_id),
          eq(api_keys.organization_id, organization_id),
          isNull(api_keys.deleted_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as OrganizationApiKeyRow | null;
  }

  async findActiveByKeyPrefix(key_prefix: string): Promise<OrganizationApiKeyRow[]> {
    const rows = await getRequestDatabase()
      .select()
      .from(api_keys)
      .where(
        and(
          eq(api_keys.key_prefix, key_prefix),
          eq(api_keys.status, 'ACTIVE'),
          isNull(api_keys.deleted_at),
        ),
      );
    return rows.map((row) => ({
      ...(row as OrganizationApiKeyRow),
      scopes: parseScopesColumn((row as { scopes?: unknown }).scopes),
    }));
  }

  async touchLastUsedAt(public_id: string): Promise<void> {
    await getRequestDatabase()
      .update(api_keys)
      .set({ last_used_at: sql`now()`, updated_at: databaseNowTimestamp })
      .where(eq(api_keys.public_id, public_id));
  }
}
