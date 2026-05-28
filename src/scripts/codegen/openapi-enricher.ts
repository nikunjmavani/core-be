/**
 * @deprecated Import from `@tooling/openapi/route-metadata` and `@tooling/openapi/enrichers`.
 * Kept for openapi-route-sync skill paths referencing `src/scripts/codegen/openapi-enricher.ts`.
 */
export { routeMetadataMap, type RouteMetadata } from '@tooling/openapi/route-metadata/index.js';
export {
  enrichSchema,
  generateFieldDescription,
  generateFieldExample,
  getPathParameterDescription,
  getPathParameterExample,
} from '@tooling/openapi/enrichers/index.js';
