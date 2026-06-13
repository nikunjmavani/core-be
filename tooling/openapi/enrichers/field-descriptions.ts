import { PAGINATION } from '@/shared/constants/index.js';

export function generateFieldDescription(
  fieldName: string,
  schema: Record<string, unknown>,
  isRequired: boolean,
): string {
  const parts: string[] = [];

  // Add field-specific description
  const fieldDesc = getFieldSpecificDescription(fieldName);
  if (fieldDesc) parts.push(fieldDesc);

  // Required indicator
  if (isRequired) {
    parts.push('**Required.**');
  } else {
    parts.push('*Optional.*');
  }

  // Validation constraints
  const constraints = extractConstraints(schema);
  if (constraints.length > 0) {
    parts.push(constraints.join(' '));
  }

  return parts.join(' ');
}

export function getFieldSpecificDescription(fieldName: string): string {
  const descriptions: Record<string, string> = {
    email: 'User email address.',
    billing_email: 'Email address for billing communications.',
    password: 'Account password.',
    current_password: 'Current password for verification.',
    new_password: 'New password to set.',
    first_name: 'User first name.',
    last_name: 'User last name.',
    name: 'Display name.',
    company_name: 'Legal company name for billing records.',
    slug: 'URL-friendly identifier (lowercase, alphanumeric, hyphens).',
    status: 'Current status.',
    description: 'Human-readable description.',
    token: 'Verification or authentication token.',
    refresh_token: 'Refresh token for obtaining new access tokens.',
    code: 'TOTP verification code (6 digits).',
    secret:
      'Optional webhook signing secret on create/update requests (encrypted at rest; never returned in responses).',
    raw_key:
      'Full organization API key returned once on create/rotate (store securely; not shown again).',
    url: 'Webhook endpoint URL that will receive event payloads.',
    logo_url: 'URL to the organization logo image.',
    avatar_url: 'URL to the user avatar image.',
    avatarKey: 'S3 object key for the avatar image.',
    user_id: 'ID of the user.',
    new_owner_user_id: 'ID of the user to transfer ownership to.',
    plan_id: 'ID of the subscription plan.',
    role_id: 'ID of the member role.',
    membership_id: 'ID of the membership.',
    organization_id: 'ID of the organization.',
    actor_user_id: 'ID of the user who performed the action.',
    provider: 'Payment or auth provider name (e.g. stripe, google).',
    provider_user_id: 'User ID from the OAuth provider.',
    method_type: 'Authentication method type (e.g. MFA_TOTP).',
    billing_cycle: 'Billing frequency.',
    trial_end: 'Trial period end date (ISO 8601).',
    cancel_at_period_end: 'If true, subscription cancels at the end of the current billing period.',
    is_primary: 'Whether this is the primary authentication method.',
    is_system: 'Whether this is a system-managed role (cannot be deleted).',
    is_enabled: 'Whether the webhook is active and receiving events.',
    is_dark_mode_enabled: 'Enable dark mode in the UI.',
    is_notifications_enabled: 'Enable push/in-app notifications.',
    is_email_notifications_enabled: 'Enable email notifications for the organization.',
    default_enabled: 'Whether notifications of this type are enabled by default.',
    is_mandatory: 'If true, users cannot opt out of this notification type.',
    notification_type: 'Notification event type identifier (e.g. subscription.updated).',
    channel: 'Delivery channel (e.g. email, push, in_app).',
    events: 'List of event types to subscribe to.',
    permission_codes: 'List of permission code strings to assign.',
    security_policy: 'Organization security policy settings (JSON object).',
    language: 'Preferred language code (e.g. en, es, fr).',
    preferred_locales: 'Ordered list of preferred locale codes.',
    muted_until: 'Mute notifications until this date (ISO 8601). Null to unmute.',
    expires_in_days: 'Number of days until the invitation or key expires.',
    tax_id: 'Tax identification number (e.g. VAT ID, EIN).',
    address_line_1: 'Primary street address.',
    address_line_2: 'Secondary address line (apt, suite, etc.).',
    city: 'City name.',
    state: 'State or province.',
    postal_code: 'ZIP or postal code.',
    country: 'Two-letter ISO 3166-1 alpha-2 country code.',
    resource_type: 'Type of resource that was acted upon.',
    action: 'Action that was performed on the resource.',
    from: 'Start of date range filter (ISO 8601).',
    to: 'End of date range filter (ISO 8601).',
    purpose: 'Upload purpose category.',
    for: 'Target entity type for the upload.',
    contentType: 'MIME type of the file being uploaded.',
    fileName: 'Original file name.',
    fileSize: 'File size in bytes.',
    key: 'S3 object key path.',
    search: 'Search query to filter results.',
    limit: `Maximum number of items to return (default ${PAGINATION.DEFAULT_LIMIT}, max ${PAGINATION.MAX_LIMIT}).`,
    after:
      'Opaque cursor for the next page. Use the value from `meta.pagination.next` on the previous response verbatim. Omit on the first page.',
    preferences: 'Array of notification preference objects.',
  };

  return descriptions[fieldName] ?? '';
}

export function extractConstraints(schema: Record<string, unknown>): string[] {
  const constraints: string[] = [];
  const type = schema.type as string | undefined;

  // String constraints
  if (type === 'string') {
    if (schema.minLength !== undefined) constraints.push(`Min length: ${schema.minLength}.`);
    if (schema.maxLength !== undefined) constraints.push(`Max length: ${schema.maxLength}.`);
    if (schema.format) constraints.push(`Format: ${schema.format}.`);
    if (schema.pattern) {
      const pattern = schema.pattern as string;
      if (pattern === '^\\d+$') constraints.push('Digits only.');
      else if (pattern.includes('[a-z0-9]'))
        constraints.push('Lowercase alphanumeric and hyphens only.');
      else constraints.push(`Pattern: \`${pattern}\`.`);
    }
  }

  // Number constraints
  if (type === 'number' || type === 'integer') {
    if (schema.minimum !== undefined) constraints.push(`Min: ${schema.minimum}.`);
    if (schema.maximum !== undefined) constraints.push(`Max: ${schema.maximum}.`);
    if (schema.exclusiveMinimum !== undefined)
      constraints.push(`Greater than ${schema.exclusiveMinimum}.`);
  }

  // Array constraints
  if (type === 'array') {
    if (schema.minItems !== undefined) constraints.push(`Min items: ${schema.minItems}.`);
    if (schema.maxItems !== undefined) constraints.push(`Max items: ${schema.maxItems}.`);
  }

  // Enum
  if (schema.enum) {
    const values = (schema.enum as unknown[]).map((v) => `\`${v}\``).join(', ');
    constraints.push(`Allowed values: ${values}.`);
  }

  // Nullable
  if (schema.nullable) {
    constraints.push('Nullable.');
  }

  return constraints;
}
