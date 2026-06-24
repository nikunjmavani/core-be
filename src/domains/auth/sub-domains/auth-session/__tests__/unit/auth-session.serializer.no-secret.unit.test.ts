import { describe, expect, it } from 'vitest';
import {
  serializeAuthSession,
  serializeAuthSessions,
} from '@/domains/auth/sub-domains/auth-session/auth-session.serializer.js';

const NO_CURRENT_SESSION = { currentSessionPublicId: null };

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    public_id: 'sess-public-id',
    user_id: 42,
    organization_id: 7,
    token_hash: 'a'.repeat(64),
    refresh_token_hash: 'b'.repeat(64),
    ip_address: '203.0.113.10',
    user_agent: 'Mozilla/5.0',
    last_active_at: new Date('2026-01-02T03:04:05.000Z'),
    expires_at: new Date('2026-01-09T03:04:05.000Z'),
    is_revoked: false,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as never;
}

describe('auth-session.serializer', () => {
  it('omits credential material and internal identifiers', () => {
    const output = serializeAuthSession(buildRow(), NO_CURRENT_SESSION);
    const keys = Object.keys(output);
    expect(keys).not.toContain('token_hash');
    expect(keys).not.toContain('refresh_token_hash');
    // `id` is the opaque public id — assert it is NOT the numeric row id
    expect(output.id).toBe('sess-public-id');
    expect(keys).not.toContain('public_id');
    expect(keys).not.toContain('user_id');
    expect(keys).not.toContain('organization_id');
    expect(keys).not.toContain('is_revoked');
    // Belt-and-braces: the serialized JSON must not contain the hashes by value.
    const json = JSON.stringify(output);
    expect(json).not.toContain('a'.repeat(64));
    expect(json).not.toContain('b'.repeat(64));
  });

  it('exposes only the safe display fields as ISO strings', () => {
    const output = serializeAuthSession(buildRow(), NO_CURRENT_SESSION);
    // 203.0.113.10 is RFC 5737 documentation space (not in the geo DB) and the bare
    // 'Mozilla/5.0' carries no device/browser token, so all derived fields are null.
    expect(output).toEqual({
      id: 'sess-public-id',
      ip_address: '203.0.113.10',
      user_agent: 'Mozilla/5.0',
      device: null,
      browser: null,
      location: null,
      is_current: false,
      last_active_at: '2026-01-02T03:04:05.000Z',
      expires_at: '2026-01-09T03:04:05.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('normalizes a missing user_agent to null', () => {
    const output = serializeAuthSession(buildRow({ user_agent: null }), NO_CURRENT_SESSION);
    expect(output.user_agent).toBeNull();
    expect(output.device).toBeNull();
    expect(output.browser).toBeNull();
  });

  it('flags the row whose public id matches the current session', () => {
    const current = serializeAuthSession(buildRow({ public_id: 'sess-current' }), {
      currentSessionPublicId: 'sess-current',
    });
    const other = serializeAuthSession(buildRow({ public_id: 'sess-other' }), {
      currentSessionPublicId: 'sess-current',
    });
    expect(current.is_current).toBe(true);
    expect(other.is_current).toBe(false);
  });

  it('parses device and browser from a real user-agent', () => {
    const output = serializeAuthSession(
      buildRow({
        user_agent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      }),
      NO_CURRENT_SESSION,
    );
    expect(output.device).toBe('Mac');
    expect(output.browser).toBe('Chrome');
  });

  it('resolves a location for a public IP and null for a private IP', () => {
    const publicIp = serializeAuthSession(buildRow({ ip_address: '8.8.8.8' }), NO_CURRENT_SESSION);
    const privateIp = serializeAuthSession(
      buildRow({ ip_address: '10.0.0.1' }),
      NO_CURRENT_SESSION,
    );
    expect(typeof publicIp.location).toBe('string');
    expect(publicIp.location).toContain('US');
    expect(privateIp.location).toBeNull();
  });

  it('serializes a list', () => {
    const output = serializeAuthSessions([buildRow(), buildRow({ public_id: 'sess-2' })], {
      currentSessionPublicId: 'sess-2',
    });
    expect(output).toHaveLength(2);
    expect(output[1]?.id).toBe('sess-2');
    expect(output[0]?.is_current).toBe(false);
    expect(output[1]?.is_current).toBe(true);
    expect(JSON.stringify(output)).not.toContain('token_hash');
  });
});
