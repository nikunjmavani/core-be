import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Notify route-registration policy scan.
 *
 * Five domains ship a rate-limit policy file; notify did not, so its only structural guard was
 * the platform-owned `authz-runtime-coverage` map. A new notify mutation could ship with no
 * per-route cap (falling back to the global limiter alone) and nothing in the domain would
 * notice.
 *
 * Asserted textually against the route files because Fastify's per-route `config` is buried
 * behind plugin encapsulation and is not reachable from a built app instance.
 *
 * Presets are taken from `rate-limit-presets.constants.ts`:
 *   - `MODERATE_AUTHED_RATE_LIMIT` — user-scoped notification writes
 *   - `ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT` — webhook config writes
 *   - `STRICT_AUTHED_RATE_LIMIT` — the test-send route, the only one that emits outbound traffic
 */
describe('notify routes rate-limit policy', () => {
  const notificationSource = readFileSync(
    join(process.cwd(), 'src/domains/notify/sub-domains/notification/notification.routes.ts'),
    'utf8',
  );
  const webhookSource = readFileSync(
    join(process.cwd(), 'src/domains/notify/sub-domains/webhook/webhook.routes.ts'),
    'utf8',
  );

  /**
   * Extracts a route's options object by balanced-brace scanning.
   *
   * A non-greedy regex stopping at the first `},` is not usable here: several notify routes
   * declare `schema` first, so a lazy match would return only the schema block and every
   * "does not carry a cap" assertion would pass vacuously.
   */
  function findRouteOptions(source: string, httpMethod: string, urlLiteral: string): string {
    const escapedUrl = urlLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const header = new RegExp(
      `zodApplication\\.${httpMethod}(?:<[^>]*>)?\\(\\s*'${escapedUrl}',\\s*\\{`,
      'm',
    );
    const match = header.exec(source);
    if (!match) {
      throw new Error(`route block not found: ${httpMethod.toUpperCase()} ${urlLiteral}`);
    }

    // match.index + match[0].length lands just past the opening `{` of the options object.
    const start = match.index + match[0].length;
    let depth = 1;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (character === '{') depth += 1;
      if (character === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(start, index);
      }
    }
    throw new Error(`unbalanced route block: ${httpMethod.toUpperCase()} ${urlLiteral}`);
  }

  const MUTATIONS: Array<{
    source: string;
    method: string;
    url: string;
    preset: string;
  }> = [
    // User-scoped notification writes — cap per user/IP so a compromised principal cannot
    // churn read-state and cache writes at the global default.
    {
      source: notificationSource,
      method: 'patch',
      url: '/notifications/:notification_id/read',
      preset: 'MODERATE_AUTHED_RATE_LIMIT',
    },
    {
      source: notificationSource,
      method: 'post',
      url: '/notifications/mark-all-read',
      preset: 'MODERATE_AUTHED_RATE_LIMIT',
    },
    {
      source: notificationSource,
      method: 'delete',
      url: '/notifications/:notification_id',
      preset: 'MODERATE_AUTHED_RATE_LIMIT',
    },
    // Organization-scoped webhook config writes.
    {
      source: webhookSource,
      method: 'post',
      url: '/webhooks',
      preset: 'ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT',
    },
    {
      source: webhookSource,
      method: 'patch',
      url: '/webhooks/:webhook_id',
      preset: 'ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT',
    },
    {
      source: webhookSource,
      method: 'delete',
      url: '/webhooks/:webhook_id',
      preset: 'ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT',
    },
    // The only notify route that makes an outbound request to a customer-controlled URL.
    {
      source: webhookSource,
      method: 'post',
      url: '/webhooks/:webhook_id/test',
      preset: 'STRICT_AUTHED_RATE_LIMIT',
    },
  ];

  for (const { source, method, url, preset } of MUTATIONS) {
    it(`${method.toUpperCase()} ${url} carries ${preset}`, () => {
      expect(findRouteOptions(source, method, url)).toContain(preset);
    });
  }

  const READS: Array<{ source: string; method: string; url: string }> = [
    { source: notificationSource, method: 'get', url: '/notifications' },
    { source: notificationSource, method: 'get', url: '/notifications/unread-count' },
    { source: notificationSource, method: 'get', url: '/notifications/:notification_id' },
    { source: webhookSource, method: 'get', url: '/webhook-events' },
    { source: webhookSource, method: 'get', url: '/webhooks' },
    { source: webhookSource, method: 'get', url: '/webhooks/:webhook_id' },
    { source: webhookSource, method: 'get', url: '/webhooks/:webhook_id/delivery-attempts' },
  ];

  it('the seven READ routes are deliberately exempt from the mutation caps', () => {
    // The policy targets mutations. Reads fall back to the global limiter by design — this
    // case exists so a future preset added to a read is a conscious edit, not a silent drift.
    for (const { source, method, url } of READS) {
      const options = findRouteOptions(source, method, url);
      expect(options, `${method.toUpperCase()} ${url}`).not.toContain('_RATE_LIMIT');
    }
  });

  it('POST /webhooks declares idempotencyRequired', () => {
    // docs/routes.txt marks this the domain's only `I = req` write. The flag lives in the same
    // route `config` as the rate-limit preset, so it belongs in the same structural guard.
    expect(findRouteOptions(webhookSource, 'post', '/webhooks')).toContain(
      'idempotencyRequired: true',
    );
  });

  it('no other notify route declares idempotencyRequired', () => {
    const otherRegistrations = [
      ...MUTATIONS.filter((mutation) => mutation.url !== '/webhooks'),
      ...READS,
    ];
    for (const { source, method, url } of otherRegistrations) {
      expect(findRouteOptions(source, method, url), `${method.toUpperCase()} ${url}`).not.toContain(
        'idempotencyRequired',
      );
    }
  });
});
