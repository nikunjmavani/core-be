import { describe, expect, it } from 'vitest';
import { ListAuditLogsQueryDto } from '@/domains/audit/audit.dto.js';

/**
 * The audit-log query. Two things about it are easy to regress.
 *
 * `include_total` defaults to the STRING `'false'`, not a boolean. It is kept as a string enum on
 * purpose so the schema renders to JSON Schema for OpenAPI; the service coerces it. The default
 * exists because a `count(*)` over an organization's audit rows is the single most expensive query
 * this route can issue — it is free on a demo tenant and punishing on a real one. Losing the
 * default, or widening the enum to accept any truthy string, turns every browse into a full count.
 *
 * The filters are also the read boundary a caller can probe. `organization_id` and `actor_user_id`
 * are accepted here but are NOT the authorization decision — RLS and the active-org claim scope the
 * rows. `.strict()` matters for the same reason: an unknown filter that silently did nothing would
 * read like a working filter to the caller.
 */
describe('audit.dto', () => {
  describe('include_total', () => {
    it('defaults to the string "false"', () => {
      expect(ListAuditLogsQueryDto.parse({}).include_total).toBe('false');
    });

    it.each(['true', 'false'])('accepts "%s"', (include_total) => {
      expect(ListAuditLogsQueryDto.safeParse({ include_total }).success).toBe(true);
    });

    it.each([
      ['a boolean true', true],
      ['a boolean false', false],
      ['the number 1', 1],
      ['an empty string', ''],
      ['TRUE (wrong case)', 'TRUE'],
      ['yes', 'yes'],
      ['null', null],
    ])('rejects %s (no coercion into the expensive path)', (_label, include_total) => {
      expect(ListAuditLogsQueryDto.safeParse({ include_total }).success).toBe(false);
    });
  });

  describe('timestamp filters', () => {
    it.each([
      ['from', { from: '2024-01-01T00:00:00.000Z' }],
      ['to', { to: '2024-12-31T23:59:59.000Z' }],
      ['both', { from: '2024-01-01T00:00:00.000Z', to: '2024-12-31T23:59:59.000Z' }],
    ])('accepts an ISO 8601 %s', (_label, input) => {
      expect(ListAuditLogsQueryDto.safeParse(input).success).toBe(true);
    });

    it('trims surrounding whitespace before parsing', () => {
      expect(
        ListAuditLogsQueryDto.safeParse({ from: '  2024-01-01T00:00:00.000Z  ' }).success,
      ).toBe(true);
    });

    it.each([
      ['a date without a time', '2024-01-01'],
      ['a unix timestamp string', '1704067200'],
      ['free text', 'last week'],
      ['an empty string', ''],
      ['an impossible date', '2024-13-45T00:00:00.000Z'],
      ['a SQL fragment', "2024-01-01' OR '1'='1"],
    ])('rejects %s as `from`', (_label, from) => {
      expect(ListAuditLogsQueryDto.safeParse({ from }).success).toBe(false);
    });

    it('rejects a numeric timestamp (no coercion)', () => {
      expect(ListAuditLogsQueryDto.safeParse({ from: 1704067200 }).success).toBe(false);
    });

    it('accepts an inverted range at the schema layer', () => {
      // `from` after `to` is not a schema error — it yields an empty page, which is a coherent
      // answer. Pinned so a reader knows the ordering rule is deliberately absent, not forgotten.
      expect(
        ListAuditLogsQueryDto.safeParse({
          from: '2024-12-31T00:00:00.000Z',
          to: '2024-01-01T00:00:00.000Z',
        }).success,
      ).toBe(true);
    });
  });

  describe('string filters', () => {
    it.each([
      ['organization_id', 'organization_id', 255],
      ['actor_user_id', 'actor_user_id', 255],
      ['resource_type', 'resource_type', 50],
      ['action', 'action', 100],
    ] as const)('%s accepts a value at its max length', (_label, field, max) => {
      expect(ListAuditLogsQueryDto.safeParse({ [field]: 'a'.repeat(max) }).success).toBe(true);
    });

    it.each([
      ['organization_id', 'organization_id', 255],
      ['actor_user_id', 'actor_user_id', 255],
      ['resource_type', 'resource_type', 50],
      ['action', 'action', 100],
    ] as const)('%s rejects a value one over its max length', (_label, field, max) => {
      expect(ListAuditLogsQueryDto.safeParse({ [field]: 'a'.repeat(max + 1) }).success).toBe(false);
    });

    it('trims filter values', () => {
      expect(ListAuditLogsQueryDto.parse({ action: '  auth.login  ' }).action).toBe('auth.login');
    });

    it('accepts an organization_id filter — scoping is RLS, not this schema', () => {
      // Pinned so schema acceptance is never mistaken for authorization: the active-org claim and
      // row-level security decide which rows come back, whatever is passed here.
      expect(ListAuditLogsQueryDto.safeParse({ organization_id: 'org_someone_else' }).success).toBe(
        true,
      );
    });

    it.each([
      ['a number', 42],
      ['null', null],
      ['an array', ['auth.login']],
    ])('rejects %s as an action filter', (_label, action) => {
      expect(ListAuditLogsQueryDto.safeParse({ action }).success).toBe(false);
    });
  });

  describe('pagination and strictness', () => {
    it('accepts the inherited cursor-pagination parameters', () => {
      expect(ListAuditLogsQueryDto.safeParse({ limit: 20 }).success).toBe(true);
    });

    it('rejects a non-numeric limit', () => {
      expect(ListAuditLogsQueryDto.safeParse({ limit: 'all' }).success).toBe(false);
    });

    it.each([
      ['an ordering hint', { order_by: 'created_at' }],
      ['a raw sql fragment', { where: '1=1' }],
      ['an offset', { offset: 100 }],
      ['a misspelled filter', { actor_id: 'usr_abc' }],
    ])('rejects %s (.strict)', (_label, input) => {
      // A silently-ignored filter reads to the caller like a working one — worse than a 422.
      expect(ListAuditLogsQueryDto.safeParse(input).success).toBe(false);
    });

    it('accepts an empty query', () => {
      expect(ListAuditLogsQueryDto.safeParse({}).success).toBe(true);
    });
  });
});
