import type { GlobalRole } from '@/shared/constants/roles.constants.js';

/**
 * Authenticated **end-user** principal attached to `request.auth` by the JWT/session
 * auth middleware. Carries the user public id plus optional email, global role, and
 * organization scope. Distinguished from {@link ApiKeyAuthContext} by `kind: 'user'`.
 */
export interface UserAuthContext {
  kind: 'user';
  userId: string;
  email?: string;
  role?: GlobalRole;
  organizationPublicId?: string;
  /**
   * Public id of the session the bearer belongs to. Set by the JWT auth middleware after
   * `verifyActiveAccessToken` resolves the session. Used to bind the step-up sentinel to
   * the session that earned it (sec-A2), so a stolen-session attacker cannot inherit a
   * step-up the legitimate user performed on a different session. Optional in the type so
   * code paths that build a synthetic `UserAuthContext` (admin scripts, tests) need not
   * fabricate one; production HTTP requests always carry it.
   */
  sessionPublicId?: string;
}

/**
 * Authenticated **organization API-key** principal attached to `request.auth` by the
 * API-key auth middleware. Unlike a user principal it carries no `userId`; the acting
 * identity is the API key itself (`apiKeyPublicId`) and it is always pinned to a single
 * organization. Distinguished from {@link UserAuthContext} by `kind: 'apiKey'`.
 */
export interface ApiKeyAuthContext {
  kind: 'apiKey';
  apiKeyPublicId: string;
  apiKeyScopes: string[];
  organizationPublicId: string;
}

/**
 * Discriminated union of authenticated principals on `request.auth`. Code must narrow on
 * `kind` (or use the `requireAuth` / `requirePrincipal` / `isApiKeyPrincipal` helpers in
 * `@/shared/utils/http/request.util.js`) before reading principal-specific fields — there is
 * intentionally no shared empty-string `userId` sentinel for API keys, so the compiler forces
 * every consumer to handle both principal kinds.
 */
export type AuthContext = UserAuthContext | ApiKeyAuthContext;
