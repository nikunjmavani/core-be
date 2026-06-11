import { and, asc, eq, isNull, sql } from 'drizzle-orm';
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
import type {
  OrganizationApiKeyAuthenticationCandidate,
  OrganizationApiKeyRow,
} from './organization-api-key.types.js';

/** Raw row shape returned by the `tenancy.resolve_api_key_for_authentication` resolver. */
interface ApiKeyAuthenticationResolverRow {
  public_id: string;
  organization_id: number | string;
  organization_public_id: string;
  key_hash: string;
  scopes: unknown;
  status: string;
  expires_at: Date | string | null;
}

interface OrganizationApiKeyListPagination {
  after?: string;
  limit: number;
}

function parseScopesColumn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Drizzle data-access for `tenancy.api_keys`. Stores hashed keys (never raw
 * secrets), normalises the `scopes` jsonb column to `string[]`, supports
 * cursor-paginated org-scoped listings, soft-delete, prefix lookup for
 * authentication, and `last_used_at` touches.
 */
export class OrganizationApiKeyRepository extends BaseRepository {
  /**
   * Counts the active (not soft-deleted) API keys for the given organization.
   *
   * @remarks
   * sec-r5-followup-ratelimit-dos-1: used by `OrganizationApiKeyService.create`
   * to enforce `ORGANIZATION_API_KEY_MAX_PER_ORG` before insert. Race-safe
   * enough for a stability cap (the per-route rate limit bounds concurrency);
   * the failure mode of two parallel inserts at N-1 is "one extra row," not
   * security-critical. Mirrors the `webhook.repository.countActiveByOrganization`
   * pattern.
   */
  async countActiveByOrganization(organization_id: number): Promise<number> {
    const rows = await getRequestDatabase()
      .select({ value: sql<number>`count(*)::int` })
      .from(api_keys)
      .where(and(eq(api_keys.organization_id, organization_id), isNull(api_keys.deleted_at)));
    return rows[0]?.value ?? 0;
  }

  async findByOrganizationId(
    organization_id: number,
    pagination: OrganizationApiKeyListPagination,
  ) {
    const { after, limit } = pagination;
    const cursorCondition = buildAscendingCreatedAtIdCursorCondition(
      api_keys.created_at,
      api_keys.id,
      parseListCursor(after),
    );
    const where = and(
      eq(api_keys.organization_id, organization_id),
      isNull(api_keys.deleted_at),
      cursorCondition,
    );
    const rows = await getRequestDatabase()
      .select()
      .from(api_keys)
      .where(where)
      .orderBy(asc(api_keys.created_at), asc(api_keys.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows) as OrganizationApiKeyRow[];
    const lastItem = items.at(-1);
    return {
      items,
      total: null,
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

  /**
   * Resolves active API-key candidates by prefix for the pre-session authentication phase.
   * Delegates to the `tenancy.resolve_api_key_for_authentication` SECURITY DEFINER resolver because
   * `tenancy.api_keys` (and `tenancy.organizations`) are FORCE RLS and the auth phase has no
   * `app.current_organization_id` context — a plain SELECT would resolve the policy to NULL and
   * return zero rows, rejecting every valid key in production.
   */
  async findActiveByKeyPrefix(
    key_prefix: string,
  ): Promise<OrganizationApiKeyAuthenticationCandidate[]> {
    const rows = await getRequestDatabase().execute(
      sql`SELECT * FROM tenancy.resolve_api_key_for_authentication(${key_prefix})`,
    );
    const resolverRows = (
      Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])
    ) as ApiKeyAuthenticationResolverRow[];
    return resolverRows.map((row) => ({
      public_id: row.public_id,
      organization_id: Number(row.organization_id),
      organization_public_id: row.organization_public_id,
      key_hash: row.key_hash,
      scopes: parseScopesColumn(row.scopes),
      status: row.status,
      expires_at: row.expires_at === null ? null : new Date(row.expires_at),
    }));
  }

  async touchLastUsedAt(public_id: string): Promise<void> {
    // audit-#8: throttle the write. Previously every authenticated API-key request
    // issued an unconditional UPDATE of last_used_at, so a single hot key serialized
    // writes to one row (row-lock contention, dead-tuple churn, autovacuum pressure).
    // Bucket to ~1 minute: the predicate makes the statement a no-op for most
    // requests, so last_used_at stays approximately accurate without write
    // amplification.
    await getRequestDatabase()
      .update(api_keys)
      .set({ last_used_at: sql`now()`, updated_at: databaseNowTimestamp })
      .where(
        and(
          eq(api_keys.public_id, public_id),
          sql`(${api_keys.last_used_at} IS NULL OR ${api_keys.last_used_at} < now() - interval '1 minute')`,
        ),
      );
  }
}
