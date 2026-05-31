import type { GlobalRole } from '@/shared/constants/roles.constants.js';

/**
 * Authenticated principal attached to `request.auth` by the auth middleware.
 * Carries the user public id plus optional global role, API-key context, and
 * organization scope; controllers read it through `requireAuth(request)`.
 */
export interface AuthContext {
  userId: string;
  email?: string;
  role?: GlobalRole;
  apiKeyPublicId?: string;
  apiKeyScopes?: string[];
  organizationPublicId?: string;
}
