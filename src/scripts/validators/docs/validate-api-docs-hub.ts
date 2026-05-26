/**
 * Static verification for API docs hub wiring (OpenAPI, Postman, Scalar Registry, /reference).
 * Run: pnpm validate:api-docs-hub
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPOSITORY_ROOT = process.cwd();

interface RequiredFile {
  relativePath: string;
  mustContain: string[];
}

const REQUIRED_FILES: RequiredFile[] = [
  {
    relativePath: '.github/workflows/reusable-openapi-postman-publish.yml',
    mustContain: [
      'pnpm docs:all',
      'pnpm docs:check',
      'pnpm docs:upload',
      'pnpm docs:upload:scalar',
      'continue-on-error: true',
      'github_environment',
      'development',
      'production',
      "env.POSTMAN_API_KEY != ''",
      "env.SCALAR_API_KEY != ''",
    ],
  },
  {
    relativePath: 'docs/reference/api/api-documentation.md',
    mustContain: ['pnpm docs:upload:hosted', 'Scalar Registry', 'GET /reference'],
  },
  {
    relativePath: 'src/scripts/codegen/upload-scalar-registry.ts',
    mustContain: ['shouldSkipHostedUpload', 'Scalar Registry'],
  },
  {
    relativePath: 'src/scripts/codegen/upload-postman-collection.ts',
    mustContain: ['shouldSkipHostedUpload', 'Postman'],
  },
  {
    relativePath: 'src/infrastructure/api-reference/scalar-api-reference.ts',
    mustContain: ['ENABLE_API_REFERENCE', '/reference'],
  },
];

function verifyRequiredFiles(): string[] {
  const failures: string[] = [];

  for (const { relativePath, mustContain } of REQUIRED_FILES) {
    const absolutePath = join(REPOSITORY_ROOT, relativePath);
    if (!existsSync(absolutePath)) {
      failures.push(`Missing file: ${relativePath}`);
      continue;
    }

    const content = readFileSync(absolutePath, 'utf-8');
    for (const fragment of mustContain) {
      if (!content.includes(fragment)) {
        failures.push(`${relativePath}: expected fragment not found: ${fragment}`);
      }
    }
  }

  return failures;
}

function verifyPackageScripts(): string[] {
  const packageJsonPath = join(REPOSITORY_ROOT, 'package.json');
  const packageData = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageData.scripts ?? {};
  const requiredScriptNames = [
    'docs:all',
    'docs:check',
    'docs:validate:openapi',
    'docs:upload',
    'docs:upload:scalar',
    'docs:upload:hosted',
  ];
  const failures: string[] = [];

  for (const scriptName of requiredScriptNames) {
    if (!scripts[scriptName]) {
      failures.push(`package.json missing script: ${scriptName}`);
    }
  }

  return failures;
}

function main(): void {
  const failures = [...verifyRequiredFiles(), ...verifyPackageScripts()];

  if (failures.length > 0) {
    console.error('API docs hub validation failed:\n');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log('API docs hub wiring verified (OpenAPI, Postman, Scalar Registry, /reference).');
}

main();
