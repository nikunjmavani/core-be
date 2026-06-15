/**
 * Shared OpenAPI response wrappers (success + paginated envelopes).
 */

// ─── Shared building blocks ────────────────────────────────────────────

export const metaSchema = {
  type: 'object' as const,
  properties: {
    request_id: { type: 'string', example: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
  },
  required: ['request_id'],
};

export const paginationMetaSchema = {
  type: 'object' as const,
  properties: {
    request_id: { type: 'string', example: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
    pagination: {
      type: 'object',
      properties: {
        per_page: { type: 'integer', example: 20 },
        next: {
          type: 'string',
          nullable: true,
          example:
            'eyJjcmVhdGVkX2F0IjoiMjAyNi0wNS0xOVQxMjowMDowMC4wMDBaIiwicHVibGljX2lkIjoiYWJjMTIzNDU2Nzg5MDEyMzQ1Njc4IiwiaWQiOjQyfQ',
          description:
            'Opaque cursor to pass as the `after` query parameter on the next request. Null when `has_more` is false.',
        },
        has_more: { type: 'boolean', example: false },
        estimated_total: { type: 'integer', example: 3 },
      },
    },
  },
  required: ['request_id', 'pagination'],
};

export function wrapSuccess(dataSchema: object, dataExample: unknown): object {
  return {
    type: 'object',
    properties: {
      data: dataSchema,
      meta: metaSchema,
    },
    example: {
      data: dataExample,
      meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
    },
  };
}

export function wrapPaginated(itemSchema: object, itemExamples: unknown[]): object {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: itemSchema },
      meta: paginationMetaSchema,
    },
    example: {
      data: itemExamples,
      meta: {
        request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b',
        pagination: {
          per_page: 20,
          next: 'eyJjcmVhdGVkX2F0IjoiMjAyNi0wNS0xOVQxMjowMDowMC4wMDBaIiwicHVibGljX2lkIjoiYWJjMTIzNDU2Nzg5MDEyMzQ1Njc4IiwiaWQiOjQyfQ',
          has_more: true,
          estimated_total: itemExamples.length,
        },
      },
    },
  };
}
// ─── Response definition type ──────────────────────────────────────────

export interface ResponseDefinition {
  statusCode: number;
  schema: object | null; // null = no body (204)
  example: unknown;
}
