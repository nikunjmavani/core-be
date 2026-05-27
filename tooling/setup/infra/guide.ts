import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as logger from '../common/logger.js';
import {
  ensureEnvSetupTemplate,
  reloadSecrets,
  isSecretFilled,
  getSecretsPath,
} from '../common/secrets.js';
import { hasGithubToken } from '../common/secrets.js';
import type { SetupConfig } from '../common/types.js';

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else if (platform === 'win32') {
      execSync(`start "${url}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
  } catch {
    logger.warn(`Could not open browser. Please open manually: ${url}`);
  }
}

async function waitForEnter(prompt: string): Promise<void> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    readline.question(prompt, () => {
      readline.close();
      resolve();
    });
  });
}

interface GuideStepDefinition {
  providerName: string;
  enabledCheck: (config: SetupConfig) => boolean;
  secretsCheck: (secrets: ReturnType<typeof reloadSecrets>) => boolean;
  browserUrls: string[];
  instructions: string[];
}

function buildGuideSteps(config: SetupConfig): GuideStepDefinition[] {
  const environmentNames = config.environments.map((environment) => environment.name);
  const secretsPath = getSecretsPath();

  const steps: GuideStepDefinition[] = [
    {
      providerName: 'Neon Postgres',
      enabledCheck: (configuration) => configuration.providers.neon.enabled,
      secretsCheck: (secrets) => isSecretFilled(secrets.neon.apiKey),
      browserUrls: ['https://console.neon.tech/app/settings/api-keys'],
      instructions: [
        '1. Log in to your Neon account (or sign up at neon.tech)',
        '2. You will land on the "API Keys" page',
        '3. Click "Create new API key"',
        `4. Name it: ${config.project.name}-setup`,
        '5. Copy the generated key (starts with napi_...)',
        `6. In ${secretsPath} set: NEON_API_KEY=<paste-here>`,
        '',
        '7. Save the file',
      ],
    },
    {
      providerName: 'AWS IAM',
      enabledCheck: (configuration) => configuration.providers.aws.enabled,
      secretsCheck: (secrets) =>
        isSecretFilled(secrets.aws.accessKeyId) && isSecretFilled(secrets.aws.secretAccessKey),
      browserUrls: ['https://console.aws.amazon.com/iam/home#/users'],
      instructions: [
        '1. Log in to AWS Console',
        '2. You will land on the IAM Users page',
        '3. Click "Create user"',
        `4. User name: ${config.providers.aws.iamUserPrefix}-setup`,
        '5. Click "Next" → "Attach policies directly"',
        '6. Search and attach: AmazonS3FullAccess, IAMFullAccess',
        '7. Click "Create user"',
        '8. Click on the new user → "Security credentials" tab',
        '9. Click "Create access key" → "Application running outside AWS"',
        `10. In ${secretsPath} set: AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...`,
        '',
        '11. Save the file',
      ],
    },
    {
      providerName: 'Sentry',
      enabledCheck: (configuration) => configuration.providers.sentry.enabled,
      secretsCheck: (secrets) => isSecretFilled(secrets.sentry.authToken),
      browserUrls: ['https://sentry.io/settings/auth-tokens/new-token/'],
      instructions: [
        '1. Log in to Sentry (or sign up at sentry.io)',
        '2. You will land on "Create New Token"',
        '3. Select scopes: project:admin, project:write, project:read',
        '4. Click "Create Token"',
        '5. Copy the token (starts with sntrys_...)',
        `6. In ${secretsPath} set: SENTRY_AUTH_TOKEN=<paste-here>`,
        '',
        '7. Save the file',
      ],
    },
    {
      providerName: 'Resend',
      enabledCheck: (configuration) => configuration.providers.resend.enabled,
      secretsCheck: (secrets) => isSecretFilled(secrets.resend.apiKey),
      browserUrls: ['https://resend.com/api-keys'],
      instructions: [
        '1. Log in to Resend (or sign up at resend.com)',
        '2. You will land on the "API Keys" page',
        '3. Click "Create API Key"',
        `4. Name it: ${config.project.name}`,
        '5. Permission: "Full access"',
        '6. Copy the key (starts with re_...)',
        `7. In ${secretsPath} set: RESEND_API_KEY=<paste-here>`,
        '',
        '8. Save the file',
      ],
    },
    {
      providerName: 'Stripe',
      enabledCheck: (configuration) => configuration.providers.stripe.enabled,
      secretsCheck: (secrets) => {
        if (!secrets.stripe) return false;
        return environmentNames.every((environmentName) =>
          isSecretFilled(secrets.stripe?.[environmentName]?.secretKey),
        );
      },
      browserUrls: [
        'https://dashboard.stripe.com/test/apikeys',
        'https://dashboard.stripe.com/apikeys',
      ],
      instructions: [
        '1. Log in to Stripe Dashboard',
        '2. For development: Use the TEST mode keys (toggle "Test mode" on)',
        '   Copy the Secret key (starts with sk_test_...)',
        '3. For production: Switch to LIVE mode',
        '   Copy the Secret key (starts with sk_live_...)',
        '4. For webhooks: Go to Developers → Webhooks → Add endpoint',
        '   (Leave webhook secrets empty for now — they are created later)',
        `5. In ${secretsPath} set for each env: STRIPE_<ENV>_SECRET_KEY=sk_... STRIPE_<ENV>_WEBHOOK_SECRET=`,
        '',
        '6. Save the file',
      ],
    },
    {
      providerName: 'Google OAuth',
      enabledCheck: (configuration) => configuration.providers.oauth.google.enabled,
      secretsCheck: (secrets) => {
        if (!secrets.oauth?.google) return false;
        return environmentNames.every((environmentName) =>
          isSecretFilled(secrets.oauth?.google?.[environmentName]?.clientId),
        );
      },
      browserUrls: ['https://console.cloud.google.com/apis/credentials'],
      instructions: [
        '1. Log in to Google Cloud Console',
        '2. Select or create a project',
        '3. Go to "APIs & Services" → "Credentials"',
        '4. Click "Create Credentials" → "OAuth 2.0 Client ID"',
        '5. Application type: "Web application"',
        `6. Create one for each environment (${environmentNames.join(', ')})`,
        '7. Set Authorized redirect URIs per env:',
        ...environmentNames.map(
          (environmentName) =>
            `   ${environmentName}: ${config.app.frontendUrl[environmentName] ?? 'http://localhost:3000'}/auth/oauth/google/callback`,
        ),
        `8. In ${secretsPath} set per env: OAUTH_GOOGLE_<ENV>_CLIENT_ID=... OAUTH_GOOGLE_<ENV>_CLIENT_SECRET=... OAUTH_GOOGLE_<ENV>_REDIRECT_URI=...`,
        '',
        '9. Save the file',
      ],
    },
    {
      providerName: 'GitHub OAuth',
      enabledCheck: (configuration) => configuration.providers.oauth.github.enabled,
      secretsCheck: (secrets) => {
        if (!secrets.oauth?.github) return false;
        return environmentNames.every((environmentName) =>
          isSecretFilled(secrets.oauth?.github?.[environmentName]?.clientId),
        );
      },
      browserUrls: ['https://github.com/settings/developers'],
      instructions: [
        '1. Log in to GitHub',
        '2. Go to Settings → Developer settings → OAuth Apps',
        '3. Click "New OAuth App"',
        `4. Create one for each environment (${environmentNames.join(', ')})`,
        '5. Set Homepage URL and Callback URL per env:',
        ...environmentNames.map(
          (environmentName) =>
            `   ${environmentName}: callback = ${config.app.frontendUrl[environmentName] ?? 'http://localhost:3000'}/auth/oauth/github/callback`,
        ),
        '6. After creating, copy Client ID and generate a Client Secret',
        `7. In ${secretsPath} set per env: OAUTH_GITHUB_<ENV>_CLIENT_ID=... OAUTH_GITHUB_<ENV>_CLIENT_SECRET=... OAUTH_GITHUB_<ENV>_REDIRECT_URI=...`,
        '',
        '8. Save the file',
      ],
    },
    {
      providerName: 'Railway',
      enabledCheck: (configuration) => configuration.providers.railway.enabled,
      secretsCheck: (secrets) => isSecretFilled(secrets.railway.token),
      browserUrls: ['https://railway.app/account/tokens'],
      instructions: [
        '1. Log in to Railway (or sign up at railway.app)',
        '2. You will land on the "Tokens" page',
        '3. Click "Create Token"',
        `4. Name it: ${config.project.name}-setup`,
        '5. Copy the token',
        `6. In ${secretsPath} set: RAILWAY_TOKEN=<paste-here>`,
        '',
        '7. Save the file',
      ],
    },
    {
      providerName: 'GitHub (token for setting repo/env secrets)',
      enabledCheck: (configuration) => configuration.providers.github.enabled,
      secretsCheck: () => hasGithubToken(),
      browserUrls: ['https://github.com/settings/tokens'],
      instructions: [
        '1. Log in to GitHub',
        '2. Go to Settings → Developer settings → Personal access tokens',
        '3. Generate new token (classic) with scopes: repo, admin:repo_hook (or use fine-grained with repo + secrets)',
        `4. In ${secretsPath} set: GITHUB_TOKEN=<paste-here>`,
        '',
        '5. Save the file (required for writing secrets to GitHub Environments)',
      ],
    },
    {
      providerName: 'Postman',
      enabledCheck: (configuration) => configuration.providers.postman.enabled,
      secretsCheck: (secrets) =>
        isSecretFilled(secrets.postman?.apiKey) && isSecretFilled(secrets.postman?.workspaceId),
      browserUrls: [
        'https://go.postman.co/settings/me/api-keys',
        'https://go.postman.co/workspaces',
      ],
      instructions: [
        '1. Log in to Postman',
        '2. First URL: API Keys page → Click "Generate API Key"',
        `3. Name it: ${config.project.name}`,
        '4. Copy the key (starts with PMAK-...)',
        '5. Second URL: Workspaces page → click your workspace',
        '6. Copy the Workspace ID from the URL bar',
        `7. In ${secretsPath} set: POSTMAN_API_KEY=... POSTMAN_WORKSPACE_ID=...`,
        '',
        '8. Save the file',
      ],
    },
  ];

  return steps;
}

export async function runGuide(config: SetupConfig): Promise<void> {
  if (ensureEnvSetupTemplate(config)) {
    logger.info(
      'Generated .env.setup template. Fill the values (see URLs in the file), then run pnpm setup:infra again.',
    );
    process.exit(0);
  }

  const steps = buildGuideSteps(config);
  const enabledSteps = steps.filter((step) => step.enabledCheck(config));
  const totalSteps = enabledSteps.length + 1; // +1 for CLI auth step

  let secrets = reloadSecrets(config);
  let currentStep = 0;

  for (const step of enabledSteps) {
    currentStep++;

    if (step.secretsCheck(secrets)) {
      logger.success(
        `Step ${currentStep}/${totalSteps} — ${step.providerName} — already configured`,
      );
      continue;
    }

    logger.stepHeader(currentStep, totalSteps, step.providerName);

    for (const url of step.browserUrls) {
      logger.info(`Opening browser: ${url}`);
      openBrowser(url);
    }

    logger.instruction(step.instructions);

    await waitForEnter('  Press Enter when done...');

    secrets = reloadSecrets(config);

    if (step.secretsCheck(secrets)) {
      logger.success(`${step.providerName} — configured`);
    } else {
      logger.warn(`${step.providerName} — some values still empty (you can fill them later)`);
    }
  }

  // GitHub auth: token in .env.setup is enough (no CLI login required)
  currentStep = totalSteps;
  const needsGithubAuth = config.providers.github.enabled;

  if (needsGithubAuth) {
    if (hasGithubToken()) {
      logger.success(
        `Step ${currentStep}/${totalSteps} — GitHub — using GITHUB_TOKEN from .env.setup (no login required)`,
      );
    } else {
      logger.stepHeader(currentStep, totalSteps, 'CLI Authentication (GitHub)');
      logger.info('Checking GitHub CLI authentication...');
      try {
        execSync('gh auth status', { stdio: 'pipe', encoding: 'utf-8' });
        logger.success('GitHub CLI — already authenticated');
      } catch {
        logger.info('Opening GitHub login...');
        try {
          execSync('gh auth login', { stdio: 'inherit' });
          logger.success('GitHub CLI — authenticated');
        } catch {
          logger.warn(
            'GitHub login failed — you can set GITHUB_TOKEN in .env.setup or run "gh auth login" later',
          );
        }
      }
    }
  }

  logger.blank();
  logger.success('Guide complete — all API keys collected.');
  logger.info('Proceeding to automated provisioning...');
  logger.blank();
}
