/**
 * Verifies generated API docs match sources (deterministic, no drift).
 * OpenAPI specs and Postman collection are gitignored; CI may have no files on disk yet.
 * Run: pnpm docs:check
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OPENAPI_DIRECTORY = join(process.cwd(), 'docs', 'openapi');
const POSTMAN_COLLECTION_PATH = join(process.cwd(), 'docs', 'postman-collection.json');
const POSTMAN_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function collectJsonFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectJsonFiles(fullPath));
    } else if (entry.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function normalizeJson(content: string): string {
  return JSON.stringify(JSON.parse(content), null, 2);
}

/** openapi-to-postmanv2 assigns random UUIDs and example bodies; strip for drift compare. */
function normalizePostmanCollection(content: string): string {
  const parsed = JSON.parse(content) as unknown;
  stripVolatilePostmanFields(parsed);
  return JSON.stringify(parsed, null, 2);
}

function stripVolatilePostmanFields(node: unknown): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const entry of node) {
      stripVolatilePostmanFields(entry);
    }
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.id === 'string' && POSTMAN_UUID_PATTERN.test(record.id)) {
    delete record.id;
  }
  if (typeof record._postman_id === 'string') {
    delete record._postman_id;
  }
  if ('response' in record) {
    delete record.response;
  }
  if (record.request && typeof record.request === 'object') {
    const request = record.request as Record<string, unknown>;
    if ('body' in request) {
      delete request.body;
    }
  }
  for (const value of Object.values(record)) {
    stripVolatilePostmanFields(value);
  }
}

function readSnapshots(filePaths: string[]): Map<string, string> {
  const snapshots = new Map<string, string>();
  for (const filePath of filePaths) {
    snapshots.set(filePath, readFileSync(filePath, 'utf-8'));
  }
  return snapshots;
}

function findDriftedFiles(before: Map<string, string>, filePaths: string[]): string[] {
  const drifted: string[] = [];
  for (const filePath of filePaths) {
    const previous = before.get(filePath);
    if (previous === undefined) {
      drifted.push(filePath.replace(`${process.cwd()}/`, ''));
      continue;
    }
    const after = readFileSync(filePath, 'utf-8');
    if (normalizeJson(previous) !== normalizeJson(after)) {
      drifted.push(filePath.replace(`${process.cwd()}/`, ''));
    }
  }
  return drifted;
}

function restoreSnapshots(snapshots: Map<string, string>): void {
  for (const [filePath, content] of snapshots) {
    writeFileSync(filePath, content, 'utf-8');
  }
}

function checkOpenApiDrift(): string[] {
  if (!existsSync(OPENAPI_DIRECTORY)) {
    mkdirSync(OPENAPI_DIRECTORY, { recursive: true });
  }

  let filePaths = collectJsonFiles(OPENAPI_DIRECTORY);

  if (filePaths.length === 0) {
    console.log(
      'No OpenAPI specs under docs/openapi/ (gitignored). Generating baseline for drift check…',
    );
    execSync('pnpm docs:generate:multilang', { stdio: 'inherit', cwd: process.cwd() });
    filePaths = collectJsonFiles(OPENAPI_DIRECTORY);
    if (filePaths.length === 0) {
      console.error('docs/openapi/ is still empty after pnpm docs:generate:multilang.');
      process.exit(1);
    }
  }

  const snapshots = readSnapshots(filePaths);

  execSync('pnpm docs:generate:multilang', { stdio: 'inherit', cwd: process.cwd() });

  const drifted = findDriftedFiles(snapshots, filePaths);

  if (drifted.length > 0) {
    restoreSnapshots(snapshots);
  }

  return drifted;
}

function checkPostmanDrift(): string[] {
  if (!existsSync(POSTMAN_COLLECTION_PATH)) {
    console.log(
      'No Postman collection at docs/postman-collection.json (gitignored). Generating baseline…',
    );
    execSync('pnpm docs:postman', { stdio: 'inherit', cwd: process.cwd() });
    if (!existsSync(POSTMAN_COLLECTION_PATH)) {
      console.error('docs/postman-collection.json missing after pnpm docs:postman.');
      process.exit(1);
    }
  }

  const before = readFileSync(POSTMAN_COLLECTION_PATH, 'utf-8');

  execSync('pnpm docs:postman', { stdio: 'inherit', cwd: process.cwd() });

  const after = readFileSync(POSTMAN_COLLECTION_PATH, 'utf-8');

  if (normalizePostmanCollection(before) !== normalizePostmanCollection(after)) {
    writeFileSync(POSTMAN_COLLECTION_PATH, before, 'utf-8');
    return ['docs/postman-collection.json'];
  }

  return [];
}

function main(): void {
  const openApiDrifted = checkOpenApiDrift();
  const postmanDrifted = checkPostmanDrift();
  const allDrifted = [...openApiDrifted, ...postmanDrifted];

  if (allDrifted.length > 0) {
    console.error(
      'Generated API docs are out of sync with route and schema sources. Run pnpm docs:all locally (files are gitignored; do not commit docs/openapi/ or docs/postman-collection.json):\n',
    );
    for (const file of allDrifted) {
      console.error(`  - ${file}`);
    }
    process.exit(1);
  }

  console.log('docs/openapi/ and docs/postman-collection.json are in sync with sources.');
}

main();
