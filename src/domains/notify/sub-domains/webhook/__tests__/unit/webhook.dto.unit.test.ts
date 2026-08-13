import { describe, expect, it } from 'vitest';
import {
  CreateWebhookDto,
  listWebhookDeliveryAttemptsQueryDto,
  listWebhooksQueryDto,
  UpdateWebhookDto,
  webhookIdParamsDto,
} from '@/domains/notify/sub-domains/webhook/webhook.dto.js';

/**
 * The webhook DTOs carry two guards that a customer's signature verification depends on.
 *
 * The first is the HTTPS-only refine: a webhook delivers organization data to a caller-supplied
 * URL, so allowing `http://` would put every payload on the wire in plaintext.
 *
 * The second is the ≥16-character secret floor (sec-UP finding #8). Before that bound existed the
 * schema accepted an empty string, `decryptFieldSecret('')` round-tripped to `''`, and
 * `createHmac('sha256', '')` produced a deterministic — therefore forgeable —
 * `X-Webhook-Signature`. The floor has to hold on BOTH entry points: create, and the rotation
 * path on update. A test that only covers create would let a rotation to `''` through.
 */
describe('webhook.dto', () => {
  const validUrl = 'https://hooks.example.com/inbound';
  const validSecret = 'a'.repeat(16);

  describe('HTTPS-only URL', () => {
    it.each([
      ['a plain https URL', 'https://hooks.example.com/inbound'],
      ['an https URL with a port', 'https://hooks.example.com:8443/inbound'],
      ['an https URL with a query string', 'https://hooks.example.com/in?tenant=1'],
    ])('accepts %s', (_label, url) => {
      expect(CreateWebhookDto.safeParse({ url, events: ['user.created'] }).success).toBe(true);
    });

    it.each([
      ['plaintext http', 'http://hooks.example.com/inbound'],
      ['ftp', 'ftp://hooks.example.com/inbound'],
      ['a javascript: URI', 'javascript:alert(1)'],
      ['a data: URI', 'data:text/plain,hello'],
      ['a file: URI', 'file:///etc/passwd'],
      ['a protocol-relative URL', '//hooks.example.com/inbound'],
      ['a bare hostname', 'hooks.example.com'],
      ['an empty string', ''],
    ])('rejects %s', (_label, url) => {
      expect(CreateWebhookDto.safeParse({ url, events: ['user.created'] }).success).toBe(false);
    });

    it('rejects an UPPERCASE scheme', () => {
      // The refine is a case-sensitive startsWith, so `HTTPS://` does not pass. Documented here
      // deliberately: it is a stricter-than-RFC behaviour, and a future "normalize the scheme"
      // change would relax a security guard rather than fix a bug.
      expect(
        CreateWebhookDto.safeParse({ url: 'HTTPS://hooks.example.com/in', events: ['a'] }).success,
      ).toBe(false);
    });

    it('trims surrounding whitespace before validating', () => {
      const result = CreateWebhookDto.parse({ url: `  ${validUrl}  `, events: ['user.created'] });

      expect(result.url).toBe(validUrl);
    });

    it('rejects a URL over 2048 characters', () => {
      const tooLong = `https://hooks.example.com/${'a'.repeat(2048)}`;

      expect(CreateWebhookDto.safeParse({ url: tooLong, events: ['a'] }).success).toBe(false);
    });

    it.each([
      ['loopback', 'https://localhost/inbound'],
      ['link-local metadata', 'https://169.254.169.254/latest/meta-data'],
      ['a private RFC1918 address', 'https://10.0.0.1/inbound'],
    ])('accepts %s at the schema layer — SSRF is the service guard', (_label, url) => {
      // Not an oversight: the DTO only enforces shape and scheme. Blocking internal targets needs
      // DNS resolution, so it lives in the service (webhook.service.ssrf-guard). Pinned here so a
      // future reader does not "fix" it in the schema and assume the service guard is redundant.
      expect(CreateWebhookDto.safeParse({ url, events: ['user.created'] }).success).toBe(true);
    });
  });

  describe('secret floor (sec-UP finding #8)', () => {
    it('accepts a secret at exactly 16 characters', () => {
      expect(
        CreateWebhookDto.safeParse({ url: validUrl, events: ['a'], secret: validSecret }).success,
      ).toBe(true);
    });

    it.each([
      ['an empty string', ''],
      ['whitespace only', '    '],
      ['a 15-character secret', 'a'.repeat(15)],
      ['a short token', 'hunter2'],
    ])('rejects %s on create', (_label, secret) => {
      expect(CreateWebhookDto.safeParse({ url: validUrl, events: ['a'], secret }).success).toBe(
        false,
      );
    });

    it.each([
      ['an empty string', ''],
      ['whitespace only', '    '],
      ['a 15-character secret', 'a'.repeat(15)],
    ])('rejects %s on the rotation path too', (_label, secret) => {
      // The same floor must hold on update — otherwise a rotation walks the secret back to a
      // forgeable value that create would have refused.
      expect(UpdateWebhookDto.safeParse({ secret }).success).toBe(false);
    });

    it('rejects a secret over 255 characters', () => {
      expect(UpdateWebhookDto.safeParse({ secret: 'a'.repeat(256) }).success).toBe(false);
    });

    it('trims a secret before measuring it', () => {
      // 16 significant characters wrapped in whitespace is 16, not 20.
      expect(UpdateWebhookDto.parse({ secret: `  ${validSecret}  ` }).secret).toBe(validSecret);
    });

    it('counts length AFTER trimming, so padding cannot fake the floor', () => {
      expect(UpdateWebhookDto.safeParse({ secret: `  ${'a'.repeat(12)}  ` }).success).toBe(false);
    });

    it('omits the secret entirely when not supplied (service auto-generates)', () => {
      const result = CreateWebhookDto.parse({ url: validUrl, events: ['a'] });

      expect(result).not.toHaveProperty('secret');
    });
  });

  describe('events', () => {
    it('requires at least one event', () => {
      expect(CreateWebhookDto.safeParse({ url: validUrl, events: [] }).success).toBe(false);
    });

    it('requires the events field on create', () => {
      expect(CreateWebhookDto.safeParse({ url: validUrl }).success).toBe(false);
    });

    it('accepts up to 50 events', () => {
      const events = Array.from({ length: 50 }, (_value, index) => `event.${index}`);

      expect(CreateWebhookDto.safeParse({ url: validUrl, events }).success).toBe(true);
    });

    it('rejects more than 50 events', () => {
      const events = Array.from({ length: 51 }, (_value, index) => `event.${index}`);

      expect(CreateWebhookDto.safeParse({ url: validUrl, events }).success).toBe(false);
    });

    it('rejects an event name over 100 characters', () => {
      expect(CreateWebhookDto.safeParse({ url: validUrl, events: ['a'.repeat(101)] }).success).toBe(
        false,
      );
    });

    it('rejects a non-array events value', () => {
      expect(CreateWebhookDto.safeParse({ url: validUrl, events: 'user.created' }).success).toBe(
        false,
      );
    });

    it('rejects an empty events array on update (not a way to clear them)', () => {
      expect(UpdateWebhookDto.safeParse({ events: [] }).success).toBe(false);
    });
  });

  describe('is_enabled', () => {
    it('defaults to true on create', () => {
      expect(CreateWebhookDto.parse({ url: validUrl, events: ['a'] }).is_enabled).toBe(true);
    });

    it('has no default on update, so omitting it leaves the row untouched', () => {
      expect(UpdateWebhookDto.parse({})).not.toHaveProperty('is_enabled');
    });

    it.each([
      ['the string "true"', 'true'],
      ['the number 1', 1],
      ['null', null],
    ])('rejects %s (no coercion)', (_label, is_enabled) => {
      expect(CreateWebhookDto.safeParse({ url: validUrl, events: ['a'], is_enabled }).success).toBe(
        false,
      );
    });
  });

  describe('mass-assignment boundary', () => {
    it.each([
      ['an organization id', { organization_id: 'org_other' }],
      ['a secret hash', { secret_encrypted: 'deadbeef' }],
      ['an id', { id: 'whk_abcdefghijklmnopqrst' }],
      ['a created_at', { created_at: '2020-01-01T00:00:00.000Z' }],
      ['a deleted_at', { deleted_at: null }],
    ])('rejects %s on create (.strict)', (_label, extra) => {
      expect(CreateWebhookDto.safeParse({ url: validUrl, events: ['a'], ...extra }).success).toBe(
        false,
      );
    });

    it('rejects an unknown key on update', () => {
      expect(UpdateWebhookDto.safeParse({ organization_id: 'org_other' }).success).toBe(false);
    });

    it('accepts a completely empty update body', () => {
      // Every field is optional; the service decides that a no-op patch is a no-op.
      expect(UpdateWebhookDto.safeParse({}).success).toBe(true);
    });
  });

  describe('query and param schemas', () => {
    it.each([
      ['listWebhooksQueryDto', listWebhooksQueryDto],
      ['listWebhookDeliveryAttemptsQueryDto', listWebhookDeliveryAttemptsQueryDto],
    ] as const)('%s defaults include_total to "false"', (_name, schema) => {
      expect(schema.parse({}).include_total).toBe('false');
    });

    it.each([
      ['listWebhooksQueryDto', listWebhooksQueryDto],
      ['listWebhookDeliveryAttemptsQueryDto', listWebhookDeliveryAttemptsQueryDto],
    ] as const)('%s rejects a boolean include_total', (_name, schema) => {
      expect(schema.safeParse({ include_total: true }).success).toBe(false);
    });

    it.each([
      ['listWebhooksQueryDto', listWebhooksQueryDto],
      ['listWebhookDeliveryAttemptsQueryDto', listWebhookDeliveryAttemptsQueryDto],
    ] as const)('%s rejects an unknown filter', (_name, schema) => {
      expect(schema.safeParse({ organization_id: 'org_other' }).success).toBe(false);
    });

    it('webhookIdParamsDto accepts a well-formed id', () => {
      expect(webhookIdParamsDto.safeParse({ webhook_id: 'whk_abcdefghijklmnopqrst' }).success).toBe(
        true,
      );
    });

    it.each([
      ['an empty id', { webhook_id: '' }],
      ['an id over 28 characters', { webhook_id: 'w'.repeat(29) }],
      ['a missing id', {}],
      ['an extra param', { webhook_id: 'whk_abc', organization_id: 'org_other' }],
    ])('webhookIdParamsDto rejects %s', (_label, input) => {
      expect(webhookIdParamsDto.safeParse(input).success).toBe(false);
    });
  });
});
