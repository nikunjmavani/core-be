export function getPathParameterExample(parameterName: string): string {
  const examples: Record<string, string> = {
    id: 'org_k7x9m2pqr4w8n1v3',
    provider: 'google',
    slug: 'acme-corporation',
    userId: 'usr_k7x9m2pqr4w8n1v3',
    membershipId: 'mbr_q8w3n7p2m5k1r4t6',
    roleId: 'rol_m3n7p2q8w5k1r4t6',
    policyId: 'pol_j5h8t3rwy6m1k9n2',
    invitationId: 'inv_r4t6m3n7p2q8w5k1',
    apiKeyId: 'key_x9k3m7n2p5q8w1r4',
    subscriptionId: 'sub_w1r4x9k3m7n2p5q8',
    webhookId: 'whk_p5q8w1r4x9k3m7n2',
    mfaMethodId: 'mfa_t6m3n7p2q8w5k1r4',
    notificationId: 'ntf_m7n2p5q8w1r4x9k3',
  };

  return examples[parameterName] ?? `example-${parameterName}`;
}

/**
 * Returns a description for a path parameter.
 */
export function getPathParameterDescription(parameterName: string): string {
  const descriptions: Record<string, string> = {
    id: 'Resource public ID',
    provider: 'OAuth provider name (e.g. google, github)',
    slug: 'Organization URL-friendly slug',
    userId: 'User public ID',
    membershipId: 'Membership public ID',
    roleId: 'Role public ID',
    policyId: 'Notification policy public ID',
    invitationId: 'Invitation public ID',
    apiKeyId: 'API key public ID',
    subscriptionId: 'Subscription public ID',
    webhookId: 'Webhook public ID',
    mfaMethodId: 'MFA method public ID',
    notificationId: 'Notification public ID',
  };

  return descriptions[parameterName] ?? `The ${parameterName} parameter`;
}
