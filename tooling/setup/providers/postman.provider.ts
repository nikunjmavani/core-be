import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as logger from '../logger.util.js';
import type { SetupSecrets, SetupState, ProviderResult } from '../types.js';

const POSTMAN_API_BASE = 'https://api.getpostman.com';
const COLLECTION_PATH = resolve(import.meta.dirname, '../../../docs/postman-collection.json');

export async function provision(secrets: SetupSecrets, state: SetupState): Promise<ProviderResult> {
  if (!secrets.postman?.apiKey || !secrets.postman?.workspaceId) {
    return { success: true, message: 'Postman: skipped (no API key or workspace ID)' };
  }

  const spinner = logger.startSpinner('Generating OpenAPI spec and Postman collection...');

  try {
    // Generate the OpenAPI spec + Postman collection
    execSync('pnpm docs:all', {
      cwd: resolve(import.meta.dirname, '../../../'),
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000,
    });

    logger.stopSpinner(spinner, 'OpenAPI spec and Postman collection generated');

    if (!existsSync(COLLECTION_PATH)) {
      logger.warn('Postman collection file not found — skipping upload');
      return {
        success: true,
        message: 'Postman: collection generated but file not found for upload',
      };
    }

    // Upload to Postman
    const uploadSpinner = logger.startSpinner('Uploading collection to Postman...');

    const collectionContent = readFileSync(COLLECTION_PATH, 'utf-8');
    const collectionData = JSON.parse(collectionContent);

    let collectionId = state.postman?.collectionId;
    let method: string;
    let url: string;

    if (collectionId) {
      method = 'PUT';
      url = `${POSTMAN_API_BASE}/collections/${collectionId}`;
    } else {
      method = 'POST';
      url = `${POSTMAN_API_BASE}/collections?workspace=${secrets.postman.workspaceId}`;
    }

    const response = await fetch(url, {
      method,
      headers: {
        'X-Api-Key': secrets.postman.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ collection: collectionData }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Postman API ${method} failed (${response.status}): ${errorBody}`);
    }

    const responseData = (await response.json()) as { collection?: { uid?: string } };
    const newCollectionId = responseData.collection?.uid;

    logger.stopSpinner(
      uploadSpinner,
      `Postman collection uploaded${newCollectionId ? `: ${newCollectionId}` : ''}`,
    );

    return {
      success: true,
      message: 'Postman: collection uploaded',
      stateUpdates: newCollectionId ? { postman: { collectionId: newCollectionId } } : undefined,
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.error(`Postman provisioning failed: ${message}`);
    return { success: false, message };
  }
}
