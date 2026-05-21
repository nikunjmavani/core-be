/**
 * Converts OpenAPI spec (docs/openapi/openapi.json) to a Postman Collection v2.1.
 *
 * Prerequisite: Run `pnpm docs:generate` first to produce docs/openapi/openapi.json.
 * Run:          pnpm docs:postman
 * Output:       docs/postman-collection.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// openapi-to-postmanv2 ships CJS — use createRequire for ESM compat
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Converter = require('openapi-to-postmanv2');

const OPENAPI_PATH = join(process.cwd(), 'docs', 'openapi', 'openapi.json');
const OUTPUT_PATH = join(process.cwd(), 'docs', 'postman-collection.json');
const PACKAGE_JSON_PATH = join(process.cwd(), 'package.json');
const SCALAR_REGISTRY_BASE_URL = 'https://registry.scalar.com';

interface CollectionInfo {
  name: string;
  description: string;
  schema: string;
  [key: string]: unknown;
}

interface PostmanCollection {
  info: CollectionInfo;
  [key: string]: unknown;
}

function getPackageVersion(): string {
  const packageData = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  return packageData.version ?? '0.0.0';
}

function buildScalarRegistryUrl(): string | undefined {
  const namespace = process.env.SCALAR_NAMESPACE;
  const slug = process.env.SCALAR_SLUG ?? 'core-be';
  if (!namespace) {
    return undefined;
  }
  return `${SCALAR_REGISTRY_BASE_URL}/@${namespace}/apis/${slug}/latest`;
}

function main(): void {
  const openapiData = readFileSync(OPENAPI_PATH, 'utf-8');
  const version = getPackageVersion();

  // Validate the OpenAPI spec before converting
  const validationResult = Converter.validate({ type: 'string', data: openapiData });
  if (!validationResult.result) {
    console.error(`OpenAPI validation failed: ${validationResult.reason}`);
    process.exit(1);
  }

  const conversionOptions = {
    schemaFaker: false,
    folderStrategy: 'Paths',
    requestNameSource: 'Fallback',
    indentCharacter: '  ',
    parametersResolution: 'Example',
    exampleParametersResolution: 'Example',
    optimizeConversion: true,
    includeAuthInfoInExample: true,
  };

  Converter.convert(
    { type: 'string', data: openapiData },
    conversionOptions,
    (
      error: Error | null,
      conversionResult: {
        result: boolean;
        reason?: string;
        output: Array<{ type: string; data: PostmanCollection }>;
      },
    ) => {
      if (error) {
        console.error('Conversion error:', error.message);
        process.exit(1);
      }

      if (!conversionResult.result) {
        console.error('Could not convert:', conversionResult.reason);
        process.exit(1);
      }

      const collectionData = conversionResult.output[0]?.data;
      if (!collectionData) {
        console.error('No collection data in conversion output');
        process.exit(1);
      }

      // Stamp version into collection info for traceability
      collectionData.info.name = `core-be API v${version}`;
      const scalarRegistryUrl = buildScalarRegistryUrl();
      const scalarRegistryLine = scalarRegistryUrl ? `\nScalar Registry: ${scalarRegistryUrl}` : '';
      collectionData.info.description = `Auto-generated Postman Collection for core-be v${version}.\nSource: docs/openapi/openapi.json (regenerate with pnpm docs:postman)${scalarRegistryLine}`;

      writeFileSync(OUTPUT_PATH, JSON.stringify(collectionData, null, 2), 'utf-8');

      const openapiSpec = JSON.parse(openapiData);
      const routeCount = Object.keys(openapiSpec.paths ?? {}).length;
      console.log(
        `Generated ${OUTPUT_PATH} (v${version}, ${routeCount} paths → Postman Collection v2.1)`,
      );
    },
  );
}

main();
