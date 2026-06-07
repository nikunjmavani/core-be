import { describe, expect, it } from 'vitest';
import { AuditSerializer } from '@/domains/audit/audit.serializer.js';

describe('AuditSerializer', () => {
  it('sec-re-08: drops every internal id and surfaces resolved public ids (strip-only allowlist)', () => {
    // Wide input row carrying every leak-class bigint. None of them may appear
    // in the output — sec-re-08 promotes the serializer from spread-then-sanitise
    // (`...row`) to a typed allowlist.
    const input = {
      id: 17,
      actor_user_id: 7,
      target_user_id: 9,
      actor_api_key_id: 23,
      organization_id: 11,
      resource_id: 42,
      action: 'membership.created',
      resource_type: 'membership',
      ip_address: '127.0.0.1',
      user_agent: 'curl/8.0',
      severity: 'INFO',
      metadata: { source: 'test', auth_method_id: 99 },
      created_at: '2026-06-07T00:00:00.000Z',
    };

    const resolution = {
      userPublicIds: new Map([
        [7, 'usr_actor_pub'],
        [9, 'usr_target_pub'],
      ]),
      organizationPublicIds: new Map([[11, 'org_owner_pub']]),
    };

    const result = AuditSerializer.many([input] as never, resolution);

    expect(result).toEqual([
      {
        actor_user_id: 'usr_actor_pub',
        target_user_id: 'usr_target_pub',
        organization_id: 'org_owner_pub',
        action: 'membership.created',
        resource_type: 'membership',
        ip_address: '127.0.0.1',
        user_agent: 'curl/8.0',
        severity: 'INFO',
        // sec-U2: metadata's auth_method_id is stripped; non-id keys flow through.
        metadata: { source: 'test' },
        created_at: '2026-06-07T00:00:00.000Z',
      },
    ]);

    // Belt-and-braces: every leak-class field is gone.
    const out = result[0]!;
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('actor_api_key_id');
    expect(out).not.toHaveProperty('resource_id');
    expect(out).not.toHaveProperty('public_id');
  });

  it('sec-re-08: emits null public ids when the resolution map does not cover an id', () => {
    // Defensive: a partial resolution map must not leak the bigint, and must
    // not throw. Better to surface null than to regress the strip.
    const result = AuditSerializer.many(
      [
        {
          actor_user_id: 7,
          target_user_id: 9,
          organization_id: 11,
          action: 'noop',
          resource_type: 'noop',
          severity: 'INFO',
          created_at: '2026-06-07T00:00:00.000Z',
        },
      ] as never,
      { userPublicIds: new Map(), organizationPublicIds: new Map() },
    );

    expect(result[0]).toMatchObject({
      actor_user_id: null,
      target_user_id: null,
      organization_id: null,
    });
  });

  it('sec-re-08: emits null public ids when the row carries null internal ids', () => {
    const result = AuditSerializer.many(
      [
        {
          actor_user_id: null,
          target_user_id: null,
          organization_id: null,
          action: 'global.event',
          resource_type: 'system',
          severity: 'INFO',
          created_at: '2026-06-07T00:00:00.000Z',
        },
      ] as never,
      { userPublicIds: new Map(), organizationPublicIds: new Map() },
    );

    expect(result[0]).toMatchObject({
      actor_user_id: null,
      target_user_id: null,
      organization_id: null,
    });
  });
});
