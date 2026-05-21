import { randomBytes } from 'node:crypto';
import * as logger from '../logger.util.js';
import type { SetupState, ProviderResult } from '../types.js';

export function provision(state: SetupState, environments: string[]): ProviderResult {
  const existingSecrets = state.jwt ?? {};
  const jwtSecrets: Record<string, string> = { ...existingSecrets };

  for (const environmentName of environments) {
    if (jwtSecrets[environmentName]) {
      logger.success(`JWT secret for "${environmentName}" — already generated`);
      continue;
    }

    jwtSecrets[environmentName] = randomBytes(48).toString('base64url');
    logger.success(`JWT secret for "${environmentName}" — generated (64 chars)`);
  }

  return {
    success: true,
    message: `JWT: ${Object.keys(jwtSecrets).length} secrets ready`,
    stateUpdates: { jwt: jwtSecrets },
  };
}
