import type { ZodTypeAny } from 'zod';
import { toJSONSchema } from 'zod';
import { enrichSchema } from '@tooling/openapi/enrichers/index.js';

/**
 * Converts a Zod object query DTO to OpenAPI 3 query parameters.
 */
export function zodToOpenApiQueryParameters(zodSchema: ZodTypeAny): object[] {
  const jsonSchema = toJSONSchema(zodSchema, {
    target: 'openapi-3.0',
    reused: 'inline',
    cycles: 'throw',
  }) as Record<string, unknown>;

  delete jsonSchema.$schema;

  const enriched = enrichSchema(jsonSchema);
  const properties = enriched.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) {
    return [];
  }

  const requiredFields = new Set((enriched.required as string[] | undefined) ?? []);

  return Object.entries(properties).map(([name, propertySchema]) => {
    const parameter: Record<string, unknown> = {
      name,
      in: 'query',
      required: requiredFields.has(name),
      description: propertySchema.description,
      schema: {
        type: propertySchema.type,
        format: propertySchema.format,
        enum: propertySchema.enum,
        minimum: propertySchema.minimum,
        maximum: propertySchema.maximum,
        default: propertySchema.default,
        nullable: propertySchema.nullable,
      },
    };

    if (propertySchema.example !== undefined) {
      parameter.example = propertySchema.example;
    }

    return parameter;
  });
}
