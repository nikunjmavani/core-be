/**
 * Runbook-as-code: rotate the RS256 JWT signing key pair (pnpm ops:jwt:rotate).
 *
 * Generates a fresh RS256 key pair and prints the new values in the exact single-line
 * escaped PEM format that `src/shared/utils/security/jwt.util.ts` (`normalizePem`)
 * expects in `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`. The current key state is shown as a
 * SHA-256 fingerprint only — private key material is never printed in full.
 *
 * DRY-RUN SAFE: the default never mutates anything. It prints the `.env.<environment>`
 * lines plus a `gh secret set` snippet for the operator to review. Pass `--apply` to push
 * the new values via `gh secret set` (requires the GitHub CLI to be authenticated).
 *
 * Usage:
 *   pnpm ops:jwt:rotate                       # print-only (dry-run)
 *   pnpm ops:jwt:rotate --apply               # push via `gh secret set` (mutates)
 *   pnpm ops:jwt:rotate --apply --repository owner/name --environment production
 */
import '@/shared/config/load-env-files.js';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ACCESS_TOKEN_EXPIRY_SECONDS } from '@/shared/constants/ttl.constants.js';

/** RSA modulus length for the generated RS256 key pair (bits). */
const RSA_MODULUS_LENGTH = 2048;

/** GitHub Actions secret name for the RS256 private key. */
const PRIVATE_KEY_SECRET_NAME = 'JWT_PRIVATE_KEY';

/** GitHub Actions secret name for the RS256 public key. */
const PUBLIC_KEY_SECRET_NAME = 'JWT_PUBLIC_KEY';

interface RotateOptions {
  apply: boolean;
  repository: string | null;
  environment: string | null;
}

interface GeneratedKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

/** Converts a multi-line PEM into the single-line, `\n`-escaped form stored in env vars. */
function toEscapedSingleLinePem(pem: string): string {
  return pem.trim().replaceAll('\n', '\\n');
}

/** SHA-256 fingerprint (hex, colon-separated bytes) of a key's normalized PEM material. */
function fingerprintPem(pem: string | undefined): string {
  if (!pem || pem.trim().length === 0) {
    return '(not set)';
  }
  const normalized = pem.replaceAll('\\n', '\n').trim();
  const digest = createHash('sha256').update(normalized).digest('hex');
  return (digest.match(/.{2}/g) ?? [digest]).join(':');
}

function parseOptions(): RotateOptions {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      repository: { type: 'string' },
      environment: { type: 'string' },
    },
  });
  return {
    apply: values.apply === true,
    repository: values.repository ?? null,
    environment: values.environment ?? null,
  };
}

function generateRs256KeyPair(): GeneratedKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: RSA_MODULUS_LENGTH,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

function printCurrentState(): void {
  console.log('Current JWT key state (fingerprints only — no private material printed):');
  console.log(
    `  ${PRIVATE_KEY_SECRET_NAME} sha256: ${fingerprintPem(process.env.JWT_PRIVATE_KEY)}`,
  );
  console.log(`  ${PUBLIC_KEY_SECRET_NAME}  sha256: ${fingerprintPem(process.env.JWT_PUBLIC_KEY)}`);
  console.log('');
}

function printEnvFileLines({ privateKeyPem, publicKeyPem }: GeneratedKeyPair): void {
  console.log('New key pair generated. Paste into the target `.env.<environment>` file:');
  console.log('');
  console.log(`${PRIVATE_KEY_SECRET_NAME}=${toEscapedSingleLinePem(privateKeyPem)}`);
  console.log(`${PUBLIC_KEY_SECRET_NAME}=${toEscapedSingleLinePem(publicKeyPem)}`);
  console.log('');
}

function buildGhSecretSetArguments({
  secretName,
  escapedPem,
  options,
}: {
  secretName: string;
  escapedPem: string;
  options: RotateOptions;
}): string[] {
  const commandArguments = ['secret', 'set', secretName, '--body', escapedPem];
  if (options.repository) {
    commandArguments.push('--repo', options.repository);
  }
  if (options.environment) {
    commandArguments.push('--env', options.environment);
  }
  return commandArguments;
}

function printSyncSnippet({
  keyPair,
  options,
}: {
  keyPair: GeneratedKeyPair;
  options: RotateOptions;
}): void {
  const privateEscaped = toEscapedSingleLinePem(keyPair.privateKeyPem);
  const publicEscaped = toEscapedSingleLinePem(keyPair.publicKeyPem);
  const repositoryFlag = options.repository ? ` --repo ${options.repository}` : '';
  const environmentFlag = options.environment ? ` --env ${options.environment}` : '';

  console.log('Review, then push the new values (operator runs manually):');
  console.log('');
  console.log(`  gh secret set ${PRIVATE_KEY_SECRET_NAME}${repositoryFlag}${environmentFlag} \\`);
  console.log(`    --body '${privateEscaped}'`);
  console.log(`  gh secret set ${PUBLIC_KEY_SECRET_NAME}${repositoryFlag}${environmentFlag} \\`);
  console.log(`    --body '${publicEscaped}'`);
  console.log('');
  console.log('Or update the `.env.<environment>` file above and run: pnpm github:sync');
  console.log('');
}

function printRotationChecklist(): void {
  const accessTokenTtlMinutes = ACCESS_TOKEN_EXPIRY_SECONDS / 60;
  console.log('Post-rotation checklist:');
  console.log(
    '  1. Deploy the new JWT_PRIVATE_KEY / JWT_PUBLIC_KEY to every runtime (API + worker).',
  );
  console.log('  2. Newly issued access tokens are signed with the new key immediately.');
  console.log(
    `  3. Keep the OLD key valid until all in-flight access tokens expire — access token TTL is ` +
      `${ACCESS_TOKEN_EXPIRY_SECONDS}s (${accessTokenTtlMinutes} min, ACCESS_TOKEN_EXPIRY_SECONDS).`,
  );
  console.log(
    '  4. Revoke / delete the OLD key only AFTER that TTL window elapses, so no live session ' +
      'verifies against a removed key.',
  );
  console.log('');
}

function applyViaGhSecretSet({
  keyPair,
  options,
}: {
  keyPair: GeneratedKeyPair;
  options: RotateOptions;
}): void {
  const secrets: Array<{ name: string; escapedPem: string }> = [
    { name: PRIVATE_KEY_SECRET_NAME, escapedPem: toEscapedSingleLinePem(keyPair.privateKeyPem) },
    { name: PUBLIC_KEY_SECRET_NAME, escapedPem: toEscapedSingleLinePem(keyPair.publicKeyPem) },
  ];

  for (const secret of secrets) {
    const commandArguments = buildGhSecretSetArguments({
      secretName: secret.name,
      escapedPem: secret.escapedPem,
      options,
    });
    console.log(`Applying: gh ${commandArguments.slice(0, 3).join(' ')} ...`);
    const result = spawnSync('gh', commandArguments, { stdio: 'inherit' });
    if (result.error) {
      throw new Error(`gh secret set ${secret.name} failed to spawn: ${result.error.message}`);
    }
    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error(`gh secret set ${secret.name} exited with code ${result.status}`);
    }
  }
  console.log('Applied new JWT key pair via gh secret set.');
  console.log('');
}

function main(): void {
  const options = parseOptions();

  printCurrentState();
  const keyPair = generateRs256KeyPair();
  printEnvFileLines(keyPair);

  if (options.apply) {
    applyViaGhSecretSet({ keyPair, options });
  } else {
    printSyncSnippet({ keyPair, options });
  }

  printRotationChecklist();
}

main();
