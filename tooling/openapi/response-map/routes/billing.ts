/** OpenAPI success responses — billing. */
import type { ResponseDefinition } from '@tooling/openapi/response-map/building-blocks.js';
import { wrapSuccess } from '@tooling/openapi/response-map/building-blocks.js';
import * as schemas from '@tooling/openapi/response-map/resource-schemas.js';

export const billingRouteResponses: Record<string, ResponseDefinition> = {
  'GET /api/v1/billing/plans': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.planSchema }, [
      {
        ...schemas.planExample,
        id: 'pln_free123',
        name: 'Free',
        description: 'For individuals and small projects',
        price_monthly: '0.00',
        price_yearly: '0.00',
      },
      schemas.planExample,
      {
        ...schemas.planExample,
        id: 'pln_ent456',
        name: 'Enterprise',
        description: 'For large organizations with custom needs',
        price_monthly: '99.00',
        price_yearly: '990.00',
      },
    ]),
    example: null,
  },
  'GET /api/v1/billing/plans/{id}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.planSchema, schemas.planExample),
    example: null,
  },

  // ── Subscriptions ──
  'GET /api/v1/billing/organizations/{id}/subscriptions': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.subscriptionSchema }, [
      schemas.subscriptionExample,
    ]),
    example: null,
  },
  'GET /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.subscriptionSchema, schemas.subscriptionExample),
    example: null,
  },
  'POST /api/v1/billing/organizations/{id}/subscriptions': {
    statusCode: 201,
    schema: wrapSuccess(schemas.subscriptionSchema, schemas.subscriptionExample),
    example: null,
  },
  'PATCH /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.subscriptionSchema, {
      ...schemas.subscriptionExample,
      cancel_at_period_end: true,
    }),
    example: null,
  },
  'POST /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}/change-plan': {
    statusCode: 200,
    schema: wrapSuccess(schemas.subscriptionSchema, {
      ...schemas.subscriptionExample,
      plan_id: 'pln_ent456',
    }),
    example: null,
  },
  'POST /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}/cancel': {
    statusCode: 200,
    schema: wrapSuccess(schemas.subscriptionSchema, {
      ...schemas.subscriptionExample,
      status: 'CANCELLED',
      cancel_at_period_end: true,
    }),
    example: null,
  },
  'POST /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}/resume': {
    statusCode: 200,
    schema: wrapSuccess(schemas.subscriptionSchema, {
      ...schemas.subscriptionExample,
      cancel_at_period_end: false,
    }),
    example: null,
  },
};
