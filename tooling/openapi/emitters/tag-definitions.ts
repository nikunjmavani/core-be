export function buildTagDefinitions(
  tagSet: Set<string>,
  tagStrings?: Record<string, string>,
): Array<{ name: string; description: string }> {
  const builtInTagDescriptions: Record<string, string> = {
    Health: 'Server health and readiness probes',
    MCP: 'Model Context Protocol — tools and resources for agents (requires admin JWT when ENABLE_MCP_SERVER=true)',
    Auth: 'Authentication — login, logout, password management',
    'Magic Link': 'Passwordless authentication via magic link emails',
    OAuth: 'OAuth 2.0 social login flows',
    Password: 'Password management (forgot, reset, change)',
    'Email Verification': 'Email address verification',
    MFA: 'Multi-factor authentication enrollment and verification',
    Token: 'Token refresh and management',
    Session: 'Session management — list and revoke active sessions',
    'Auth Method': 'Manage linked authentication methods (password, OAuth, etc.)',
    User: 'Current user profile management',
    'User Settings': 'User personal settings (dark mode, language, etc.)',
    'Notification Preferences': 'Per-user notification type and channel preferences',
    Admin: 'Platform administration endpoints (requires admin role)',
    'User Management': 'Admin user management — list, update, suspend, delete users',
    Organization: 'Organization CRUD and management',
    'Organization Settings': 'Organization-level settings and policies',
    'API Key': 'Organization API key management',
    'Notification Policy': 'Organization notification delivery policies',
    'Audit Log': 'Audit trail of actions performed in the organization',
    Membership: 'Organization membership management',
    Invitation: 'Member invitations — create, accept, decline, resend',
    Role: 'Custom role management within organizations',
    Permission: 'Available permissions that can be assigned to roles',
    Billing: 'Billing and subscription management',
    Plan: 'Subscription plans and pricing',
    Subscription: 'Subscription lifecycle — create, upgrade, cancel, resume',
    'Stripe Webhook': 'Stripe billing webhook receiver (raw body, signature verified)',
    Notification: 'User notification feed',
    Webhook: 'Webhook endpoint management and delivery history',
    Upload: 'Pre-signed URL generation for file uploads',
  };
  const tagDescriptions = tagStrings ?? builtInTagDescriptions;

  const tagOrder = [
    'Health',
    'MCP',
    'Auth',
    'Magic Link',
    'OAuth',
    'Password',
    'Email Verification',
    'MFA',
    'Token',
    'Session',
    'Auth Method',
    'User',
    'User Settings',
    'Notification Preferences',
    'Admin',
    'User Management',
    'Organization',
    'Organization Settings',
    'API Key',
    'Notification Policy',
    'Audit Log',
    'Membership',
    'Invitation',
    'Role',
    'Permission',
    'Billing',
    'Plan',
    'Subscription',
    'Stripe Webhook',
    'Notification',
    'Webhook',
    'Upload',
  ];

  const sortedTags = [...tagSet].sort((left, right) => {
    const indexLeft = tagOrder.indexOf(left);
    const indexRight = tagOrder.indexOf(right);
    if (indexLeft === -1 && indexRight === -1) return left.localeCompare(right);
    if (indexLeft === -1) return 1;
    if (indexRight === -1) return -1;
    return indexLeft - indexRight;
  });

  return sortedTags.map((tag) => ({
    name: tag,
    description: tagDescriptions[tag] ?? builtInTagDescriptions[tag] ?? tag,
  }));
}
