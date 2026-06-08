import { faker } from '@faker-js/faker';
faker.seed(42);

export function generateFieldExample(fieldName: string, schema: Record<string, unknown>): unknown {
  const type = schema.type as string | undefined;
  const format = schema.format as string | undefined;
  const enumValues = schema.enum as unknown[] | undefined;

  // If there are enum values, pick the first one
  if (enumValues && enumValues.length > 0) {
    return enumValues[0];
  }

  // Field-name-based mapping (most specific first)
  const lowerField = fieldName.toLowerCase();

  // ── Email fields ──
  if (lowerField === 'email' || lowerField === 'billing_email') {
    return faker.internet.email({ firstName: 'john', lastName: 'doe' });
  }

  // ── Password fields ──
  if (lowerField.includes('password')) {
    return 'P@ssw0rd!2026secure';
  }

  // ── Name fields ──
  if (lowerField === 'first_name') return faker.person.firstName();
  if (lowerField === 'last_name') return faker.person.lastName();
  if (lowerField === 'company_name') return faker.company.name();
  if (lowerField === 'name' && !lowerField.includes('file')) return faker.company.name();

  // ── Token / secret / code fields ──
  if (lowerField === 'code') return '123456';
  if (lowerField === 'token' || lowerField === 'refresh_token') {
    return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  }
  // OpenAPI examples are visible in published docs (Swagger / Redoc / Postman).
  // Using real Stripe prefixes (`whsec_`, `sk_live_`) here would (a) ship a
  // misleading example — these endpoints return our OWN webhook signing key
  // and our OWN organization API key, NOT a Stripe value — and (b) trip
  // GitHub Secret Scanning on push because the raw scanner matches the Stripe
  // regex and cannot tell the difference between a leaked prod secret and a
  // documentation placeholder. Use clearly-redacted opaque placeholders.
  if (lowerField === 'secret') return '<webhook-signing-key-shown-once>';
  if (lowerField === 'raw_key') return '<api-key-shown-once>';

  // ── URL fields ──
  if (lowerField === 'url') return 'https://api.example.com/webhooks/receive';
  if (lowerField === 'logo_url') return 'https://cdn.example.com/logos/acme-corp.png';
  if (lowerField === 'avatar_url') return 'https://cdn.example.com/avatars/john-doe.jpg';
  if (lowerField === 'avatar_key' || lowerField === 'avatarkey')
    return 'avatars/usr_abc123def456.jpg';

  // ── Slug ──
  if (lowerField === 'slug') return 'acme-corporation';

  // ── Status fields ──
  if (lowerField === 'status') return 'ACTIVE';

  // ── ID fields (specific before catch-all) ──
  if (
    lowerField === 'user_id' ||
    lowerField === 'new_owner_user_id' ||
    lowerField === 'actor_user_id'
  ) {
    return 'usr_k7x9m2pqr4w8n1v3';
  }
  if (lowerField === 'plan_id') return 'pln_j5h8t3rwy6m1k9n2';
  if (lowerField === 'role_id') return 'rol_m3n7p2q8w5k1r4t6';
  if (lowerField === 'membership_id') return 'mbr_q8w3n7p2m5k1r4t6';
  if (lowerField === 'organization_id') return 'org_r4t6m3n7p2q8w5k1';
  if (lowerField === 'provider_user_id') return '110248495921238986420';
  if (lowerField.endsWith('_id') && type === 'string') return faker.string.alphanumeric(18);

  // ── Description ──
  if (lowerField === 'description') return faker.lorem.sentence();

  // ── Provider fields ──
  if (lowerField === 'provider') return 'stripe';
  if (lowerField === 'method_type') return 'MFA_TOTP';

  // ── Billing fields ──
  if (lowerField === 'billing_cycle') return 'monthly';
  if (lowerField === 'tax_id') return 'US12-3456789';
  if (lowerField === 'address_line_1') return faker.location.streetAddress();
  if (lowerField === 'address_line_2') return faker.location.secondaryAddress();
  if (lowerField === 'city') return faker.location.city();
  if (lowerField === 'state') return faker.location.state();
  if (lowerField === 'postal_code') return faker.location.zipCode();
  if (lowerField === 'country') return 'US';

  // ── Notification fields ──
  if (lowerField === 'notification_type') return 'subscription.updated';
  if (lowerField === 'channel') return 'email';
  if (lowerField === 'events')
    return ['subscription.created', 'subscription.updated', 'member.invited'];

  // ── Permission fields ──
  if (lowerField === 'permission_codes')
    return ['ORGANIZATION_READ', 'MEMBERSHIP_READ', 'ROLE_READ'];

  // ── Boolean fields ──
  if (lowerField.startsWith('is_') || lowerField === 'cancel_at_period_end') {
    if (lowerField === 'is_primary' || lowerField === 'is_system') return false;
    if (
      lowerField === 'is_enabled' ||
      lowerField === 'is_default' ||
      lowerField === 'default_enabled'
    )
      return true;
    if (lowerField === 'is_mandatory') return false;
    return true;
  }

  // ── Date fields ──
  if (lowerField === 'trial_end' || lowerField === 'muted_until') {
    return '2026-03-15T00:00:00.000Z';
  }
  if (lowerField === 'from') return '2026-01-01T00:00:00.000Z';
  if (lowerField === 'to') return '2026-02-14T23:59:59.999Z';

  // ── Locale / language fields ──
  if (lowerField === 'language') return 'en';
  if (lowerField === 'preferred_locales') return ['en', 'es', 'fr'];

  // ── Security policy ──
  if (lowerField === 'security_policy') return { mfa_required: true, session_timeout_minutes: 30 };

  // ── Expires in days ──
  if (lowerField === 'expires_in_days') return 7;

  // ── Resource type / action (audit) ──
  if (lowerField === 'resource_type') return 'organization';
  if (lowerField === 'action') return 'organization.created';

  // ── Upload fields ──
  if (lowerField === 'purpose') return 'avatar';
  if (lowerField === 'for') return 'user';
  if (lowerField === 'content_type' || lowerField === 'contenttype') return 'image/png';
  if (lowerField === 'file_name' || lowerField === 'filename') return 'profile-photo.png';
  if (lowerField === 'file_size' || lowerField === 'filesize') return 204800;
  if (lowerField === 'key') return 'organization-logos/org_abc123.png';

  // ── Search ──
  if (lowerField === 'search') return 'john';

  // ── Pagination fields ──
  if (lowerField === 'limit') return 20;
  if (lowerField === 'after') {
    return 'eyJjcmVhdGVkX2F0IjoiMjAyNi0wNS0xOVQxMjowMDowMC4wMDBaIiwicHVibGljX2lkIjoiYWJjMTIzNDU2Nzg5MDEyMzQ1Njc4IiwiaWQiOjQyfQ';
  }

  // ── Type-based fallback ──
  if (format === 'email') return faker.internet.email();
  if (format === 'uri' || format === 'url') return faker.internet.url();
  if (format === 'date-time') return '2026-02-14T10:30:00.000Z';
  if (format === 'uuid') return faker.string.uuid();

  if (type === 'string') return faker.lorem.word();
  if (type === 'number' || type === 'integer') return 1;
  if (type === 'boolean') return true;

  return undefined;
}
