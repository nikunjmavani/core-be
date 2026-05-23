import { randomBytes } from 'node:crypto';
import * as logger from '../../../common/logger.js';
import type {
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '../../../common/types.js';

export function provision(state: SetupState, environments: string[]): ProviderResult {
  const existingSecrets = state.jwt ?? {};
  const jwtSecrets: NonNullable<SetupState['jwt']> = { ...existingSecrets };

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

function allEnvironmentsHaveJwt(environments: string[], state: SetupState): boolean {
  if (!state.jwt) return false;
  return environments.every((environmentName) => Boolean(state.jwt?.[environmentName]));
}

export const setupJwtProvider: InfraProvider = {
  key: 'jwt',
  name: 'JWT secrets',
  isEnabled: () => true,
  disabledReason: () => '',
  settingsReview: ({ environments }) => [
    {
      bucket: 'resource',
      provider: 'JWT',
      detail: `${environments.length} secrets (auto-generated)`,
    },
  ],
  buildStep: (context: InfraProviderContext) => ({
    name: 'JWT secrets',
    enabled: true,
    instructions: [
      `Will generate JWT signing secrets per environment: ${context.environments.join(', ')}.`,
      'Local-only — no third-party API calls. Secrets are stored in .setup-state.json.',
    ],
    alreadyDone: () => allEnvironmentsHaveJwt(context.environments, context.state),
    alreadyDoneMessage: 'JWT secrets already generated for all environments',
    execute: async () => {
      const result = provision(context.state, context.environments);
      context.applyStateUpdates(result.stateUpdates ?? {});
      return result;
    },
    verifyState: () => ({
      ok: allEnvironmentsHaveJwt(context.environments, context.state),
      message: context.state.jwt
        ? `${Object.keys(context.state.jwt).length} environment secrets generated`
        : 'no JWT secrets recorded',
    }),
  }),
  deleteInstructions: ({ state }) => {
    const jwt = state.jwt;
    if (!jwt || Object.keys(jwt).length === 0) return [];
    return [
      {
        provider: 'JWT secrets',
        dashboardUrl: 'tooling/setup/.setup-state.json (local file)',
        steps: [
          'JWT secrets are local-only — no third-party resource to delete.',
          'Edit tooling/setup/.setup-state.json and remove the "jwt" entries (or delete the whole file) to force fresh generation on the next run.',
          'After rotating, re-deploy services so they pick up the new JWT_SECRET.',
        ],
        resources: Object.keys(jwt).map((environmentName) => ({
          label: `Secret (${environmentName})`,
          identifier: '<redacted, see .setup-state.json>',
        })),
      },
    ];
  },
};
