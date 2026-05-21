import type { GlobalRole } from '@/shared/constants/roles.js';

export interface AuthContext {
  userId: string;
  email?: string;
  role?: GlobalRole;
  apiKeyPublicId?: string;
  apiKeyScopes?: string[];
  organizationPublicId?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}
