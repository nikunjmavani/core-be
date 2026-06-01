import { describe, expect, it } from 'vitest';
import { buildAuditActorFields } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import type { ApiKeyAuthContext, UserAuthContext } from '@/shared/types/index.js';

describe('buildAuditActorFields', () => {
  it('attributes a user principal to actorUserPublicId', () => {
    const auth: UserAuthContext = { kind: 'user', userId: 'user-1', role: 'user' };
    expect(buildAuditActorFields(auth)).toEqual({ actorUserPublicId: 'user-1' });
  });

  it('attributes an API-key principal to actorApiKeyPublicId and never a user actor', () => {
    const auth: ApiKeyAuthContext = {
      kind: 'apiKey',
      apiKeyPublicId: 'key-1',
      apiKeyScopes: ['members:roles:manage'],
      organizationPublicId: 'org-1',
    };
    const fields = buildAuditActorFields(auth);
    expect(fields).toEqual({ actorApiKeyPublicId: 'key-1' });
    expect(fields.actorUserPublicId).toBeUndefined();
  });
});
