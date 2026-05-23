/**
 * Interactive Railway custom-domain helper.
 *
 * Walks the user through one prompt at a time:
 *   1. Pick environment (development / production)
 *   2. Pick service (api / worker)
 *   3. Optional target port (Railway only sets a target port when the service exposes one)
 *   4. Custom domain to attach (e.g. api.albetrios.com)
 *   5. Confirm
 *
 * Then it ensures a Railway-generated service domain exists, attaches the custom domain
 * (idempotent — re-running with the same custom domain re-uses the existing one),
 * and prints the DNS records the user needs to add at their DNS provider.
 *
 * Run via: pnpm setup:railway-domain
 */
import { createInterface } from 'node:readline';
import * as logger from './logger.js';
import { loadConfig } from '../common/config.js';
import { loadState } from '../common/state.js';
import { loadEnvSetupIntoProcess } from './secrets.js';

const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';

async function railwayGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Railway GraphQL failed (${response.status}): ${body}`);
  }

  const result = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (result.errors?.length) {
    throw new Error(
      `Railway GraphQL errors: ${result.errors.map((error) => error.message).join('; ')}`,
    );
  }

  return result.data as T;
}

interface ServiceDomain {
  id: string;
  domain: string;
  targetPort: number | null;
}

interface CustomDomainStatus {
  certificateStatus: string;
  verified: boolean;
  dnsRecords: Array<{
    recordType: string;
    hostlabel: string;
    fqdn: string;
    requiredValue: string;
    currentValue: string;
    status: string;
    purpose: string;
    zone: string;
  }>;
}

interface CustomDomainSummary {
  id: string;
  domain: string;
  targetPort: number | null;
  status: CustomDomainStatus;
}

async function fetchServiceDomains(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
): Promise<ServiceDomain[]> {
  const result = await railwayGraphQL<{
    domains: { serviceDomains: ServiceDomain[] };
  }>(
    token,
    `
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        serviceDomains {
          id
          domain
          targetPort
        }
      }
    }
  `,
    { projectId, environmentId, serviceId },
  );
  return result.domains.serviceDomains;
}

async function fetchCustomDomains(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
): Promise<CustomDomainSummary[]> {
  const result = await railwayGraphQL<{
    domains: { customDomains: CustomDomainSummary[] };
  }>(
    token,
    `
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        customDomains {
          id
          domain
          targetPort
          status {
            certificateStatus
            verified
            dnsRecords {
              recordType
              hostlabel
              fqdn
              requiredValue
              currentValue
              status
              purpose
              zone
            }
          }
        }
      }
    }
  `,
    { projectId, environmentId, serviceId },
  );
  return result.domains.customDomains;
}

async function createServiceDomain(
  token: string,
  environmentId: string,
  serviceId: string,
  targetPort: number | undefined,
): Promise<ServiceDomain> {
  const result = await railwayGraphQL<{ serviceDomainCreate: ServiceDomain }>(
    token,
    `
    mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) {
        id
        domain
        targetPort
      }
    }
  `,
    {
      input: {
        environmentId,
        serviceId,
        ...(typeof targetPort === 'number' ? { targetPort } : {}),
      },
    },
  );
  return result.serviceDomainCreate;
}

async function createCustomDomain(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  domain: string,
  targetPort: number | undefined,
): Promise<CustomDomainSummary> {
  const result = await railwayGraphQL<{ customDomainCreate: CustomDomainSummary }>(
    token,
    `
    mutation($input: CustomDomainCreateInput!) {
      customDomainCreate(input: $input) {
        id
        domain
        targetPort
        status {
          certificateStatus
          verified
          dnsRecords {
            recordType
            hostlabel
            fqdn
            requiredValue
            currentValue
            status
            purpose
            zone
          }
        }
      }
    }
  `,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        domain,
        ...(typeof targetPort === 'number' ? { targetPort } : {}),
      },
    },
  );
  return result.customDomainCreate;
}

interface PromptChoice {
  label: string;
  value: string;
}

async function ask(question: string, defaultValue?: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    readline.question(`  ${question}${suffix}: `, (answer) => {
      readline.close();
      const trimmed = answer.trim();
      resolvePromise(trimmed === '' && defaultValue !== undefined ? defaultValue : trimmed);
    });
  });
}

async function selectOne(
  question: string,
  choices: PromptChoice[],
  defaultIndex = 0,
): Promise<string> {
  if (choices.length === 0) {
    throw new Error(`No choices available for "${question}"`);
  }
  if (choices.length === 1) {
    logger.info(`  ${question}: ${choices[0].label} (only option)`);
    return choices[0].value;
  }

  logger.info(question);
  for (const [index, choice] of choices.entries()) {
    logger.info(`    ${index + 1}) ${choice.label}`);
  }

  while (true) {
    const answer = await ask('Pick number', String(defaultIndex + 1));
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < choices.length) {
      return choices[index].value;
    }
    logger.warn(`  Invalid choice. Enter a number between 1 and ${choices.length}.`);
  }
}

function parseOptionalPort(input: string): number | undefined {
  if (input === '') return undefined;
  const port = Number.parseInt(input, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: "${input}" (expected integer 1-65535 or empty)`);
  }
  return port;
}

function isValidDomain(domain: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

function printDnsRecords(domain: string, status: CustomDomainStatus): void {
  logger.blank();
  logger.info(`DNS records to add at your DNS provider for ${domain}:`);
  if (status.dnsRecords.length === 0) {
    logger.warn('  Railway returned no DNS records yet — check the Railway dashboard.');
    return;
  }
  for (const record of status.dnsRecords) {
    logger.info(`  Type:     ${record.recordType}`);
    logger.info(`  Host:     ${record.hostlabel || '@'}`);
    logger.info(`  Value:    ${record.requiredValue}`);
    logger.info(`  Zone:     ${record.zone}`);
    logger.info(`  FQDN:     ${record.fqdn}`);
    logger.info(`  Status:   ${record.status} (current: ${record.currentValue || '-'})`);
    logger.info(`  Purpose:  ${record.purpose}`);
    logger.blank();
  }
  logger.info(
    `Certificate status: ${status.certificateStatus} (verified: ${status.verified ? 'yes' : 'no'})`,
  );
}

async function main(): Promise<void> {
  loadEnvSetupIntoProcess();
  const token = (process.env.RAILWAY_TOKEN ?? '').trim();
  if (!token) {
    logger.error('RAILWAY_TOKEN is not set in .env.setup or process.env.');
    logger.info('Get a token at https://railway.app/account/tokens and add it to .env.setup.');
    process.exit(1);
  }

  const config = loadConfig();
  const state = loadState();

  if (!state.railway?.projectId) {
    logger.error(
      '.setup-state.json has no railway.projectId. Run pnpm setup:infra first to provision Railway.',
    );
    process.exit(1);
  }

  const projectId = state.railway.projectId;
  const environmentEntries = Object.entries(state.railway.environments ?? {});
  if (environmentEntries.length === 0) {
    logger.error(
      'No Railway environments recorded in .setup-state.json. Run pnpm setup:infra to populate them.',
    );
    process.exit(1);
  }

  logger.banner(
    config.project.displayName,
    environmentEntries.map(([name]) => name),
  );
  logger.info('Railway custom-domain setup — 5 steps');
  logger.blank();

  // Step 1 — environment
  logger.info('Step 1/5 — Environment');
  const environmentName = await selectOne(
    '  Pick the Railway environment',
    environmentEntries.map(([name, value]) => ({
      label: `${name} (${value.environmentId})`,
      value: name,
    })),
  );
  const environmentEntry = state.railway.environments![environmentName];
  const environmentId = environmentEntry.environmentId;
  logger.success(`  Environment: ${environmentName} (${environmentId})`);
  logger.blank();

  // Step 2 — service
  logger.info('Step 2/5 — Service');
  const serviceEntries = Object.entries(environmentEntry.services);
  if (serviceEntries.length === 0) {
    logger.error(
      `Environment "${environmentName}" has no services in state. Run pnpm setup:infra to attach api/worker.`,
    );
    process.exit(1);
  }
  const serviceName = await selectOne(
    '  Pick the service',
    serviceEntries.map(([name, value]) => ({
      label: `${name} (${value.serviceId})`,
      value: name,
    })),
  );
  const serviceId = environmentEntry.services[serviceName].serviceId;
  logger.success(`  Service: ${serviceName} (${serviceId})`);
  logger.blank();

  // Step 3 — target port (optional)
  logger.info('Step 3/5 — Target port');
  logger.info(
    '  Required only when the service listens on a non-default port (e.g. 3000 for the API).',
  );
  const portRaw = await ask('  Target port (Enter to skip)', '');
  const targetPort = parseOptionalPort(portRaw);
  logger.success(`  Target port: ${targetPort === undefined ? '(none)' : targetPort}`);
  logger.blank();

  // Step 4 — custom domain
  logger.info('Step 4/5 — Custom domain');
  const customDomain = (await ask('  Custom domain (e.g. api.example.com)')).toLowerCase();
  if (!isValidDomain(customDomain)) {
    logger.error(`Invalid domain: "${customDomain}"`);
    process.exit(1);
  }
  logger.success(`  Domain: ${customDomain}`);
  logger.blank();

  // Step 5 — confirm
  logger.info('Step 5/5 — Confirm');
  logger.info(`  Project:      ${config.project.name} (${projectId})`);
  logger.info(`  Environment:  ${environmentName}`);
  logger.info(`  Service:      ${serviceName}`);
  logger.info(`  Target port:  ${targetPort === undefined ? '(none)' : targetPort}`);
  logger.info(`  Custom domain: ${customDomain}`);
  const confirm = (await ask('  Proceed? (y/N)', 'N')).toLowerCase();
  if (!(confirm === 'y' || confirm === 'yes')) {
    logger.info('Aborted. Nothing changed.');
    process.exit(0);
  }
  logger.blank();

  // Action 1 — ensure a Railway service domain exists (so the service has a backing hostname).
  const existingServiceDomains = await fetchServiceDomains(
    token,
    projectId,
    environmentId,
    serviceId,
  );
  let serviceDomain = existingServiceDomains[0];
  if (serviceDomain) {
    logger.info(`Service domain already exists: ${serviceDomain.domain}`);
  } else {
    logger.info('Creating Railway service domain...');
    serviceDomain = await createServiceDomain(token, environmentId, serviceId, targetPort);
    logger.success(`Service domain created: ${serviceDomain.domain}`);
  }
  logger.blank();

  // Action 2 — attach (or adopt) the custom domain.
  const existingCustomDomains = await fetchCustomDomains(
    token,
    projectId,
    environmentId,
    serviceId,
  );
  let customDomainResult = existingCustomDomains.find(
    (entry) => entry.domain.toLowerCase() === customDomain,
  );
  if (customDomainResult) {
    logger.info(`Custom domain already attached: ${customDomainResult.domain}`);
  } else {
    logger.info(`Attaching custom domain ${customDomain}...`);
    customDomainResult = await createCustomDomain(
      token,
      projectId,
      environmentId,
      serviceId,
      customDomain,
      targetPort,
    );
    logger.success(`Custom domain attached: ${customDomainResult.domain}`);
  }

  // Action 3 — print DNS records the user must add.
  printDnsRecords(customDomainResult.domain, customDomainResult.status);

  logger.blank();
  logger.success('Done. Add the DNS records above at your DNS provider, then re-run this script');
  logger.success('(or check the Railway dashboard) to verify certificate issuance.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.blank();
  logger.error(message);
  process.exit(1);
});
