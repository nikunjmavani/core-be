/**
 * Uploads (upserts) the Postman Collection to a Postman workspace via the Postman API.
 *
 * Behaviour:
 *   1. Lists collections in the target workspace.
 *   2. If a collection with a matching name prefix ("core-be API") exists → updates it (PUT).
 *   3. Otherwise → creates a new collection (POST).
 *   Postman keeps full change history on every PUT, so versions are tracked automatically.
 *
 * Required env vars:
 *   POSTMAN_API_KEY       — Postman API key (https://go.postman.co/settings/me/api-keys)
 *   POSTMAN_WORKSPACE_ID  — Target workspace UUID
 *
 * Run: pnpm docs:upload
 */
import '@/shared/config/load-env-files.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldSkipHostedUpload } from './hosted-docs-upload.util.js';

const POSTMAN_UPLOAD_REQUIRED_VARIABLES = ['POSTMAN_API_KEY', 'POSTMAN_WORKSPACE_ID'] as const;
const POSTMAN_API_BASE = 'https://api.getpostman.com';
const COLLECTION_PATH = join(process.cwd(), 'docs', 'postman-collection.json');
const COLLECTION_NAME_PREFIX = 'core-be API';

interface PostmanCollectionInfo {
  name: string;
  uid: string;
  [key: string]: unknown;
}

interface PostmanListResponse {
  collections: PostmanCollectionInfo[];
}

interface PostmanErrorResponse {
  error: { name: string; message: string };
}

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function postmanFetch<T>(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${POSTMAN_API_BASE}${path}`, {
    ...options,
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });

  const body = await response.json();

  if (!response.ok) {
    const errorBody = body as PostmanErrorResponse;
    throw new Error(
      `Postman API ${response.status}: ${errorBody.error?.message ?? response.statusText}`,
    );
  }

  return body as T;
}

async function findExistingCollection(
  apiKey: string,
  workspaceIdentifier: string,
): Promise<PostmanCollectionInfo | undefined> {
  const data = await postmanFetch<PostmanListResponse>(
    `/collections?workspace=${workspaceIdentifier}`,
    apiKey,
  );

  return data.collections?.find((collection) => collection.name.startsWith(COLLECTION_NAME_PREFIX));
}

async function createCollection(
  apiKey: string,
  workspaceIdentifier: string,
  collectionData: object,
): Promise<string> {
  const result = await postmanFetch<{ collection: { uid: string; name: string } }>(
    `/collections?workspace=${workspaceIdentifier}`,
    apiKey,
    {
      method: 'POST',
      body: JSON.stringify({ collection: collectionData }),
    },
  );
  return result.collection.uid;
}

async function updateCollection(
  apiKey: string,
  collectionUid: string,
  collectionData: object,
): Promise<void> {
  await postmanFetch<{ collection: { uid: string } }>(`/collections/${collectionUid}`, apiKey, {
    method: 'PUT',
    body: JSON.stringify({ collection: collectionData }),
  });
}

async function main(): Promise<void> {
  if (shouldSkipHostedUpload('Postman', POSTMAN_UPLOAD_REQUIRED_VARIABLES)) {
    return;
  }

  const apiKey = getRequiredEnvironmentVariable('POSTMAN_API_KEY');
  const workspaceIdentifier = getRequiredEnvironmentVariable('POSTMAN_WORKSPACE_ID');

  // Read local collection
  const collectionData = JSON.parse(readFileSync(COLLECTION_PATH, 'utf-8'));
  const collectionName: string = collectionData.info?.name ?? COLLECTION_NAME_PREFIX;

  console.log(`Uploading "${collectionName}" to workspace ${workspaceIdentifier}...`);

  // Check for existing collection in workspace
  const existingCollection = await findExistingCollection(apiKey, workspaceIdentifier);

  if (existingCollection) {
    console.log(
      `Found existing collection "${existingCollection.name}" (${existingCollection.uid}). Updating...`,
    );
    await updateCollection(apiKey, existingCollection.uid, collectionData);
    console.log(`Updated collection → ${existingCollection.uid}`);
    console.log(`View: https://go.postman.co/collection/${existingCollection.uid}`);
  } else {
    console.log('No existing collection found. Creating new...');
    const newUid = await createCollection(apiKey, workspaceIdentifier, collectionData);
    console.log(`Created collection → ${newUid}`);
    console.log(`View: https://go.postman.co/collection/${newUid}`);
  }

  console.log('Done. Postman tracks version history automatically on each update.');
}

main().catch((error: Error) => {
  console.error('Upload failed:', error.message);
  process.exit(1);
});
