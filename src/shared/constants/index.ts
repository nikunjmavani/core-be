export { GLOBAL_ROLES } from './roles.js';
export type { GlobalRole } from './roles.js';

/** Generic message returned to clients for any 500 response; internal details go to Sentry only. */
export const EXTERNAL_ERROR_MESSAGE = 'Something went wrong! Please try again later.';

// Bounded patterns: slug and UUID format validation on controlled input
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // eslint-disable-line security/detect-unsafe-regex
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export * from './ttl.constants.js';
export * from './limits.constants.js';
export * from './pagination.constants.js';
export * from './security.constants.js';
export * from './billing.constants.js';
