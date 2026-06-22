import { describe, expect, it } from 'vitest';
import { evaluateCallApiPolicy } from '@/infrastructure/mcp/mcp-capabilities.js';

/**
 * R14: the MCP `call_api` tool is an admin-authority in-process API proxy. `evaluateCallApiPolicy`
 * consolidates every gate it enforces — the `/api/v1/` (+ health) path gate, the read-only-by-
 * default method restriction, and the optional operator path-prefix allowlist.
 */
describe('evaluateCallApiPolicy (R14)', () => {
  const base = { allowMutations: false, allowedPathPrefixes: [] as string[] };

  it('allows GET to /api/v1/ paths by default', () => {
    expect(evaluateCallApiPolicy({ ...base, method: 'GET', path: '/api/v1/audit/logs' })).toEqual({
      allowed: true,
    });
  });

  it('allows GET to the health endpoints', () => {
    expect(evaluateCallApiPolicy({ ...base, method: 'GET', path: '/livez' })).toEqual({
      allowed: true,
    });
    expect(evaluateCallApiPolicy({ ...base, method: 'GET', path: '/readyz' })).toEqual({
      allowed: true,
    });
  });

  it('rejects paths outside the allowed roots', () => {
    const result = evaluateCallApiPolicy({ ...base, method: 'GET', path: '/internal/secrets' });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toMatch(/must start with \/api\/v1\//);
  });

  it.each([
    'POST',
    'PATCH',
    'PUT',
    'DELETE',
  ])('rejects %s by default (read-only unless MCP_CALL_API_ALLOW_MUTATIONS)', (method) => {
    const result = evaluateCallApiPolicy({ ...base, method, path: '/api/v1/tenancy/organization' });
    expect(result.allowed).toBe(false);
    if (!result.allowed)
      expect(result.message).toMatch(/read-only unless MCP_CALL_API_ALLOW_MUTATIONS/);
  });

  it('allows mutating methods only when allowMutations is true', () => {
    expect(
      evaluateCallApiPolicy({
        ...base,
        allowMutations: true,
        method: 'DELETE',
        path: '/api/v1/tenancy/organization',
      }),
    ).toEqual({ allowed: true });
  });

  it('enforces the optional path-prefix allowlist when configured', () => {
    const allowedPathPrefixes = ['/api/v1/audit/'];
    expect(
      evaluateCallApiPolicy({
        allowMutations: false,
        allowedPathPrefixes,
        method: 'GET',
        path: '/api/v1/audit/logs',
      }),
    ).toEqual({ allowed: true });

    const blocked = evaluateCallApiPolicy({
      allowMutations: false,
      allowedPathPrefixes,
      method: 'GET',
      path: '/api/v1/billing/subscriptions',
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.message).toMatch(/allowlist/);
  });
});
