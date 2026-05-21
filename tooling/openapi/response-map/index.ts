/**
 * Route → response body map for OpenAPI generation.
 */
export type { ResponseDefinition } from './building-blocks.js';
export { wrapPaginated, wrapSuccess } from './building-blocks.js';

import { auditUploadRouteResponses } from './routes/audit-upload.js';
import { billingRouteResponses } from './routes/billing.js';
import { healthAuthUserRouteResponses } from './routes/health-auth-user.js';
import { notifyRouteResponses } from './routes/notify.js';
import { tenancyRouteResponses } from './routes/tenancy.js';
import { userAdminRouteResponses } from './routes/user-admin.js';

export const routeResponseMap: Record<string, import('./building-blocks.js').ResponseDefinition> = {
  ...healthAuthUserRouteResponses,
  ...userAdminRouteResponses,
  ...tenancyRouteResponses,
  ...billingRouteResponses,
  ...notifyRouteResponses,
  ...auditUploadRouteResponses,
};
