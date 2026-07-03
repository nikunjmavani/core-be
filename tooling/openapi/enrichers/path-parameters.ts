import {
  PARAM_NAME_TO_ENTITY,
  PUBLIC_ID_PREFIXES,
  type PublicIdEntity,
} from '@/shared/utils/identity/public-id.util.js';

const ENTITY_LABELS: Record<PublicIdEntity, string> = {
  user: 'user',
  organization: 'organization',
  membership: 'membership',
  memberInvitation: 'invitation',
  memberRole: 'role',
  organizationApiKey: 'API key',
  organizationNotificationPolicy: 'notification policy',
  authSession: 'session',
  authMethod: 'auth method',
  webauthnCredential: 'passkey',
  notification: 'notification',
  webhook: 'webhook',
  plan: 'plan',
  subscription: 'subscription',
  upload: 'upload',
  userDataExport: 'data export',
  webhookDeliveryAttempt: 'webhook delivery attempt',
};

/** Stable, realistic 21-char example core (alphabet [a-z0-9]). */
const EXAMPLE_CORE = 'a1b2c3d4e5f6g7h8i9j0k';

function entityFor(parameterName: string): PublicIdEntity | undefined {
  return PARAM_NAME_TO_ENTITY[parameterName as keyof typeof PARAM_NAME_TO_ENTITY];
}

/**
 * Example value for a path parameter. Typed-id params get a valid prefixed
 * example (`org_a1b2c3d4e5f6g7h8i9j0k`).
 */
export function getPathParameterExample(parameterName: string): string {
  const entity = entityFor(parameterName);
  if (entity) {
    return `${PUBLIC_ID_PREFIXES[entity]}_${EXAMPLE_CORE}`;
  }
  const literals: Record<string, string> = {
    provider: 'google',
    slug: 'acme-corporation',
    circuit_name: 'stripe',
  };
  return literals[parameterName] ?? `example-${parameterName}`;
}

/**
 * Paddle-style description for a path parameter: what it identifies, its
 * prefix, and the exact validation pattern.
 */
export function getPathParameterDescription(parameterName: string): string {
  const entity = entityFor(parameterName);
  if (entity) {
    const prefix = PUBLIC_ID_PREFIXES[entity];
    return `Unique ID for this ${ENTITY_LABELS[entity]}, prefixed with \`${prefix}_\`. Pattern: \`^${prefix}_[a-z0-9]{21}$\``;
  }
  const literals: Record<string, string> = {
    provider: 'OAuth provider name (`google` | `github`)',
    slug: 'Organization URL-friendly slug',
    circuit_name: 'Managed circuit breaker name (`stripe` | `s3` | `resend` | `turnstile`)',
  };
  return literals[parameterName] ?? `The ${parameterName} parameter`;
}

/**
 * JSON-schema fragment for a path parameter — typed ids carry the strict
 * per-entity pattern so generated clients validate before calling.
 */
export function getPathParameterSchema(parameterName: string): Record<string, unknown> {
  const entity = entityFor(parameterName);
  if (entity) {
    const prefix = PUBLIC_ID_PREFIXES[entity];
    return { type: 'string', pattern: `^${prefix}_[a-z0-9]{21}$` };
  }
  return { type: 'string' };
}
