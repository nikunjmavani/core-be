/**
 * @deprecated Import from `@tooling/openapi/enrichers`.
 * Kept for skill paths referencing `src/scripts/codegen/openapi-enricher.ts`.
 *
 * Route-level descriptions live on Zod schemas in `*.routes.ts` (read by
 * `@tooling/openapi/extractors/route-schema-metadata.ts`); the legacy
 * `routeMetadataMap` was removed once every route was migrated.
 */
export {
  enrichSchema,
  generateFieldDescription,
  generateFieldExample,
  getPathParameterDescription,
  getPathParameterExample,
} from '@tooling/openapi/enrichers/index.js';
