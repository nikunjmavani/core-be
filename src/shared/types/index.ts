import type { GlobalRole } from '@/shared/constants/roles.constants.js';

export interface AuthContext {
  userId: string;
  email?: string;
  role?: GlobalRole;
  apiKeyPublicId?: string;
  apiKeyScopes?: string[];
  organizationPublicId?: string;
}
