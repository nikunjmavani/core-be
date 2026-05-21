import { generateFieldDescription } from './field-descriptions.js';
import { generateFieldExample } from './field-examples.js';

export function enrichSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const enriched = { ...schema };
  const type = schema.type as string | undefined;
  const requiredFields = (schema.required as string[]) ?? [];

  if (type === 'object' && schema.properties) {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const enrichedProperties: Record<string, Record<string, unknown>> = {};
    const exampleObject: Record<string, unknown> = {};

    for (const [fieldName, fieldSchema] of Object.entries(properties)) {
      const enrichedField = { ...fieldSchema };
      const isRequired = requiredFields.includes(fieldName);

      // Add description with validation info
      const description = generateFieldDescription(fieldName, fieldSchema, isRequired);
      if (description) enrichedField.description = description;

      // Add example
      const example = generateFieldExample(fieldName, fieldSchema);
      if (example !== undefined) {
        enrichedField.example = example;
        exampleObject[fieldName] = example;
      }

      // Recurse into nested objects
      if (fieldSchema.type === 'object' && fieldSchema.properties) {
        enrichedProperties[fieldName] = enrichSchema(enrichedField);
      } else if (fieldSchema.type === 'array' && fieldSchema.items) {
        const items = fieldSchema.items as Record<string, unknown>;
        if (items.type === 'object' && items.properties) {
          enrichedField.items = enrichSchema(items);
        }
        enrichedProperties[fieldName] = enrichedField;
      } else {
        enrichedProperties[fieldName] = enrichedField;
      }
    }

    enriched.properties = enrichedProperties;

    // Add a top-level example for the whole object
    if (Object.keys(exampleObject).length > 0) {
      enriched.example = exampleObject;
    }
  }

  return enriched;
}
