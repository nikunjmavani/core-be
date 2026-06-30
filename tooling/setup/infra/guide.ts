import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as logger from '@tooling/setup/common/logger.js';
import { SetupAbort } from '@tooling/setup/common/setup-error.js';
import {
  ensureEnvSetupTemplate,
  reloadSecrets,
  isSecretFilled,
  getSecretsPath,
  getEnvSetupValue,
  setEnvSetupVariable,
} from '@tooling/setup/common/secrets.js';
import { hasGithubToken } from '@tooling/setup/common/secrets.js';
import { questionHidden } from '@tooling/setup/common/prompts.js';
import { clipboardAvailable, copyToClipboard } from '@tooling/setup/common/clipboard.js';
import {
  frontendUrlForEnvironment,
  oauthAppDisplayName,
  everyEnvironmentHasEnvKeys,
} from '@tooling/setup/envs/env-file-setup.util.js';
import { posthogGuideConfigured } from '@tooling/setup/infra/providers/setup-posthog/setup-posthog.provider.js';
import type { SetupConfig } from '@tooling/setup/common/types.js';

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

/** A value to collect via hidden input and write into `.setup-credentials` for the user. */
interface GuideSecretPrompt {
  /** Env var name in `.setup-credentials` (e.g. `CAPTCHA_SECRET`). */
  key: string;
  /** What to ask the user (e.g. `Turnstile SECRET key (0x4AAA…)`). */
  label: string;
}

interface GuideStepDefinition {
  providerName: string;
  enabledCheck: (config: SetupConfig) => boolean;
  secretsCheck: (secrets: ReturnType<typeof reloadSecrets>) => boolean;
  browserUrls: string[];
  instructions: string[];
  /**
   * Optional values to collect interactively (hidden input) and write straight into
   * `.setup-credentials`. When present, the guide prompts for each missing one instead of
   * asking the user to hand-edit the file. Omit for providers whose values live in
   * `.env.<environment>` (OAuth, Scalar) — those keep the manual-edit flow.
   */
  secretPrompts?: GuideSecretPrompt[];
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
      secretPrompts: [
        { key: 'NEON_API_KEY', label: 'Neon API key (napi_…)' },
        { key: 'NEON_ORG_ID', label: 'Neon Org ID' },
      ],
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
      secretPrompts: [
        { key: 'AWS_ACCESS_KEY_ID', label: 'AWS Access Key ID' },
        { key: 'AWS_SECRET_ACCESS_KEY', label: 'AWS Secret Access Key' },
      ],
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
      secretPrompts: [{ key: 'SENTRY_AUTH_TOKEN', label: 'Sentry auth token (sntrys_…)' }],
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
      secretPrompts: [{ key: 'RESEND_API_KEY', label: 'Resend API key (re_…)' }],
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
      // Stripe keys live in .setup/.setup-credentials per environment (STRIPE_<ENV>_SECRET_KEY);
      // setup writes STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET into each .env.<environment>.
      secretsCheck: () =>
        environmentNames.every((environmentName) =>
          isSecretFilled(
            getEnvSetupValue(
              `STRIPE_${environmentName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_SECRET_KEY`,
            ),
          ),
        ),
      browserUrls: [
        'https://dashboard.stripe.com/test/apikeys',
        'https://dashboard.stripe.com/apikeys',
      ],
      // Collect each per-environment key via HIDDEN input → saved straight to .setup-credentials.
      // The secret is never echoed to the terminal and the file is never hand-edited.
      secretPrompts: config.environments.flatMap((environment) => {
        const environmentName = environment.name;
        const prefix = `STRIPE_${environmentName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
        const keyFormat = environmentName === 'development' ? 'sk_test_…' : 'sk_live_…';
        return [
          {
            key: `${prefix}_SECRET_KEY`,
            label: `Stripe ${environmentName} SECRET key (${keyFormat})`,
          },
          {
            key: `${prefix}_WEBHOOK_SECRET`,
            label: `Stripe ${environmentName} webhook signing secret (whsec_…, optional — Enter to skip)`,
          },
        ];
      }),
      instructions: [
        'For EACH environment you will paste the key at a hidden prompt below — the input is never',
        'shown and is saved to .setup/.setup-credentials for you (no hand-editing, no clear-text paste).',
        '1. The API-keys page was opened and its link copied to your clipboard. In Stripe:',
        '   Developers → API keys → "Secret key" → Reveal → copy.',
        '     • development → TEST mode  (sk_test_… , dashboard.stripe.com/test/apikeys)',
        '     • production  → LIVE mode  (sk_live_… , dashboard.stripe.com/apikeys)',
        '2. Webhook signing secret (optional): Developers → Webhooks → your endpoint → "Signing secret" (whsec_…).',
        '   For local dev, `stripe listen --print-secret` also prints a whsec_… you can paste.',
        'setup validates each key via the Stripe API and writes STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET',
        'into each .env.<environment>.',
      ],
    },
    {
      providerName: 'Google OAuth',
      enabledCheck: (configuration) => configuration.providers.oauth.google.enabled,
      secretsCheck: () => everyEnvironmentHasEnvKeys(config, ['OAUTH_GOOGLE_CLIENT_ID']),
      browserUrls: ['https://console.cloud.google.com/apis/credentials'],
      instructions: config.environments.flatMap((environment) => {
        const environmentName = environment.name;
        const appName = oauthAppDisplayName(config.project.name, environmentName);
        const frontendUrl = frontendUrlForEnvironment(config, environmentName);
        const callbackUrl = frontendUrl
          ? `${frontendUrl}/auth/oauth/google/callback`
          : 'https://<your-frontend>/auth/oauth/google/callback';
        return [
          `--- ${environmentName} → .env.${environmentName} ---`,
          '1. Google Cloud Console → APIs & Services → Credentials',
          '2. Create Credentials → OAuth 2.0 Client ID → Web application',
          `3. Application name: "${appName}"`,
          `4. Authorized redirect URI: ${callbackUrl}`,
          `5. In .env.${environmentName} set:`,
          '   OAUTH_GOOGLE_CLIENT_ID=….apps.googleusercontent.com',
          '   OAUTH_GOOGLE_CLIENT_SECRET=…',
          `   OAUTH_GOOGLE_REDIRECT_URI=${callbackUrl}`,
          '',
        ];
      }),
    },
    {
      providerName: 'GitHub OAuth',
      enabledCheck: (configuration) => configuration.providers.oauth.github.enabled,
      secretsCheck: () => everyEnvironmentHasEnvKeys(config, ['OAUTH_GITHUB_CLIENT_ID']),
      browserUrls: ['https://github.com/settings/developers'],
      instructions: config.environments.flatMap((environment) => {
        const environmentName = environment.name;
        const appName = oauthAppDisplayName(config.project.name, environmentName);
        const frontendUrl = frontendUrlForEnvironment(config, environmentName);
        // Backend OAuth handler is mounted under /api/v1 — the callback MUST include it.
        const callbackUrl = frontendUrl
          ? `${frontendUrl}/api/v1/auth/oauth/github/callback`
          : 'https://<your-backend>/api/v1/auth/oauth/github/callback';
        return [
          `--- ${environmentName} → .env.${environmentName} ---`,
          '1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App',
          `2. Application name: "${appName}"`,
          frontendUrl
            ? `3. Homepage URL: ${frontendUrl}`
            : `3. Set app.frontendUrl.${environmentName} in setup.config.json first`,
          `4. Authorization callback URL: ${callbackUrl}`,
          '5. Generate client secret',
          `6. In .env.${environmentName} set:`,
          '   OAUTH_GITHUB_CLIENT_ID=…',
          '   OAUTH_GITHUB_CLIENT_SECRET=…',
          `   OAUTH_GITHUB_REDIRECT_URI=${callbackUrl}`,
          '',
        ];
      }),
    },
    {
      providerName: 'PostHog',
      enabledCheck: (configuration) => configuration.providers.posthog.enabled,
      secretsCheck: () => posthogGuideConfigured(),
      browserUrls: ['https://us.posthog.com/settings/user-api-keys'],
      secretPrompts: [
        { key: 'POSTHOG_PERSONAL_API_KEY', label: 'PostHog personal API key (phx_…)' },
      ],
      instructions: [
        '1. Log in to PostHog (the link is already on your clipboard / the page opens automatically)',
        '2. Settings → Personal API keys → "Create personal API key" → scopes: "All access"',
        '3. Copy the key (starts with phx_...)',
        '4. Paste it below when prompted (input is hidden) — it is saved to .setup-credentials for you.',
        `   Setup then reuses (or creates) the "${config.project.name}" project under org`,
        `   "${config.project.organization}" and writes POSTHOG_KEY + POSTHOG_HOST into each .env.<environment>.`,
        '   Optional: POSTHOG_PROJECT_API_KEY=phc_... skips the API lookup; POSTHOG_PROJECT_ID pins a project.',
      ],
    },
    {
      providerName: 'Cloudflare Turnstile',
      enabledCheck: (configuration) => configuration.providers.turnstile.enabled,
      secretsCheck: (secrets) =>
        isSecretFilled(secrets.cloudflare.apiToken) && isSecretFilled(secrets.cloudflare.accountId),
      browserUrls: ['https://dash.cloudflare.com/profile/api-tokens'],
      instructions: [
        '1. Log in to Cloudflare and open the API Tokens page (link is on your clipboard)',
        '2. Create Token → Custom token → permission "Turnstile : Edit" → Continue → Create',
        '3. Copy the token. Also copy your Account ID (any domain → Overview → right sidebar)',
        '4. Paste both below when prompted (input is hidden) — saved to .setup-credentials for you.',
        `   Setup then CREATES one widget per environment (${config.project.name}-<env>) and writes`,
        '   CAPTCHA_PROVIDER/SITE_KEY/SECRET into each .env.<environment> — no manual widget needed.',
      ],
      secretPrompts: [
        { key: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare API token (Turnstile:Edit)' },
        { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Cloudflare Account ID' },
      ],
    },
    {
      providerName: 'Railway',
      enabledCheck: (configuration) => configuration.providers.railway.enabled,
      secretsCheck: (secrets) => isSecretFilled(secrets.railway.apiToken),
      browserUrls: ['https://railway.com/account/tokens'],
      secretPrompts: [{ key: 'RAILWAY_API_TOKEN', label: 'Railway account token' }],
      instructions: [
        '1. Log in to Railway (or sign up at railway.app)',
        '2. You will land on the "Tokens" page',
        '3. Click "Create Token"',
        `4. Name it: ${config.project.name}-setup`,
        '5. Copy the token',
        `6. In ${secretsPath} set: RAILWAY_API_TOKEN=<paste-here>`,
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
      secretsCheck: () =>
        everyEnvironmentHasEnvKeys(config, ['POSTMAN_API_KEY', 'POSTMAN_WORKSPACE_ID']),
      browserUrls: [
        'https://go.postman.co/settings/me/api-keys',
        'https://go.postman.co/workspaces',
      ],
      instructions: config.environments.flatMap((environment) => {
        const environmentName = environment.name;
        return [
          `--- ${environmentName} → .env.${environmentName} ---`,
          '1. Postman → Settings → API Keys → Generate API Key',
          `2. Name: ${config.project.name}-${environmentName}`,
          '3. Workspaces → open target workspace → copy Workspace ID from URL',
          `4. In .env.${environmentName} set:`,
          '   POSTMAN_API_KEY=PMAK-…',
          '   POSTMAN_WORKSPACE_ID=…',
          '',
        ];
      }),
    },
    {
      providerName: 'Scalar',
      enabledCheck: (configuration) => configuration.providers.scalar.enabled,
      secretsCheck: () =>
        everyEnvironmentHasEnvKeys(config, ['SCALAR_API_KEY', 'SCALAR_NAMESPACE']),
      browserUrls: ['https://dashboard.scalar.com'],
      instructions: config.environments.flatMap((environment) => {
        const environmentName = environment.name;
        const slug =
          environmentName === 'production'
            ? config.project.name
            : `${config.project.name}-${environmentName}`;
        return [
          `--- ${environmentName} → .env.${environmentName} ---`,
          '1. Scalar dashboard → Settings → API keys → create key',
          `2. Name: ${slug}`,
          '3. Note your team namespace',
          `4. In .env.${environmentName} set:`,
          '   SCALAR_API_KEY=…',
          '   SCALAR_NAMESPACE=your-team',
          `   SCALAR_SLUG=${slug}  (optional — defaults to project name)`,
          '',
        ];
      }),
    },
  ];

  return steps;
}

export async function runGuide(config: SetupConfig): Promise<void> {
  if (ensureEnvSetupTemplate(config)) {
    throw new SetupAbort(
      'Generated .setup/.setup-credentials template. Fill the values (see URLs in the file), then run pnpm setup:infra again.',
    );
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

    // Open the dashboard AND copy the primary link to the clipboard, so the user can just
    // paste it if the tab did not open. Announced prominently (this is the main affordance).
    const [primaryUrl, ...otherUrls] = step.browserUrls;
    if (primaryUrl) {
      openBrowser(primaryUrl);
      if (clipboardAvailable() && copyToClipboard(primaryUrl)) {
        logger.success('🔗 Link copied to your clipboard — just paste it in the browser:');
        logger.info(`     ${primaryUrl}`);
      } else {
        logger.info(`Open this link: ${primaryUrl}`);
      }
    }
    for (const url of otherUrls) {
      logger.info(`Also opening: ${url}`);
      openBrowser(url);
    }

    logger.instruction(step.instructions);

    // When the step declares secret prompts, collect each missing value via HIDDEN input and
    // write it straight into .setup-credentials — the user never pastes a secret in the clear,
    // and never has to hand-edit the file. Otherwise fall back to the manual "press Enter" flow.
    if (step.secretPrompts && step.secretPrompts.length > 0 && process.stdin.isTTY) {
      for (const { key, label } of step.secretPrompts) {
        if (isSecretFilled(getEnvSetupValue(key))) {
          logger.success(`  ${key} — already set, skipping`);
          continue;
        }
        const value = await questionHidden(`  ${label} [hidden, paste & Enter]: `);
        if (value) {
          setEnvSetupVariable(key, value);
          logger.success(`  ✓ ${key} saved to .setup-credentials (input hidden)`);
        } else {
          logger.warn(`  ${key} left empty — set it later in ${getSecretsPath()}`);
        }
      }
    } else {
      await waitForEnter('  Press Enter when done...');
    }

    secrets = reloadSecrets(config);

    if (step.secretsCheck(secrets)) {
      logger.success(`${step.providerName} — configured`);
    } else {
      logger.warn(`${step.providerName} — some values still empty (you can fill them later)`);
    }
  }

  // GitHub auth: token in .setup/.setup-credentials is enough (no CLI login required)
  currentStep = totalSteps;
  const needsGithubAuth = config.providers.github.enabled;

  if (needsGithubAuth) {
    if (hasGithubToken()) {
      logger.success(
        `Step ${currentStep}/${totalSteps} — GitHub — using GITHUB_TOKEN from .setup/.setup-credentials (no login required)`,
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
            'GitHub login failed — you can set GITHUB_TOKEN in .setup/.setup-credentials or run "gh auth login" later',
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
