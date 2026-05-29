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
 * Zero-downtime rotation uses an overlap window: keep BOTH the old and new public keys in the
 * `JWT_PUBLIC_KEYS` kid→PEM map and sign with the new `JWT_SIGNING_KID`. Tokens minted under the
 * old kid keep verifying until they expire; once the access-token TTL elapses, drop the old key
 * from `JWT_PUBLIC_KEYS`. See docs/deployment/runbooks/jwt-key-rotation.md.
 *
 * Usage:
 *   pnpm ops:jwt:rotate                       # print-only (dry-run)
 *   pnpm ops:jwt:rotate --kid 2026-05-prod-b  # name the new kid (default: jwt-<date>)
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
  kid: string;
}

/** Default `kid` for a freshly generated key when the operator does not pass `--kid`. */
function defaultKid(): string {
  return `jwt-${new Date().toISOString().slice(0, 10)}`;
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
      kid: { type: 'string' },
    },
  });
  return {
    apply: values.apply === true,
    repository: values.repository ?? null,
    environment: values.environment ?? null,
    kid: values.kid && values.kid.trim().length > 0 ? values.kid.trim() : defaultKid(),
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

/**
 * Prints the zero-downtime overlap-window snippet: a `JWT_PUBLIC_KEYS` kid→PEM map containing both
 * the current public key (kept for in-flight tokens) and the new one, plus the new `JWT_SIGNING_KID`.
 */
function printOverlapWindowSnippet({
  keyPair,
  options,
}: {
  keyPair: GeneratedKeyPair;
  options: RotateOptions;
}): void {
  const currentPublicPem = process.env.JWT_PUBLIC_KEY;
  const currentKid = process.env.JWT_SIGNING_KID ?? 'default';
  const overlapMap: Record<string, string> = {};
  if (currentPublicPem && currentPublicPem.trim().length > 0) {
    overlapMap[currentKid] = toEscapedSingleLinePem(currentPublicPem.replaceAll('\\n', '\n'));
  }
  overlapMap[options.kid] = toEscapedSingleLinePem(keyPair.publicKeyPem);

  console.log('Zero-downtime overlap window (recommended) — verify against current + previous:');
  console.log('');
  console.log(`  JWT_SIGNING_KID=${options.kid}`);
  console.log(`  JWT_PUBLIC_KEYS=${JSON.stringify(overlapMap)}`);
  console.log('');
  console.log(
    '  Deploy the new JWT_PRIVATE_KEY together with the JWT_PUBLIC_KEYS map above and the new',
  );
  console.log(
    '  JWT_SIGNING_KID. Drop the old kid from JWT_PUBLIC_KEYS after the TTL window below.',
  );
  console.log('');
}

function printRotationChecklist(): void {
  const accessTokenTtlMinutes = ACCESS_TOKEN_EXPIRY_SECONDS / 60;
  console.log('Post-rotation checklist:');
  console.log(
    '  1. Deploy the new JWT_PRIVATE_KEY plus the JWT_PUBLIC_KEYS overlap map and new ' +
      'JWT_SIGNING_KID to every runtime (API + worker).',
  );
  console.log('  2. Newly issued access tokens are signed with the new kid immediately.');
  console.log(
    `  3. Tokens minted under the OLD kid keep verifying via JWT_PUBLIC_KEYS until they expire — ` +
      `access token TTL is ${ACCESS_TOKEN_EXPIRY_SECONDS}s (${accessTokenTtlMinutes} min, ACCESS_TOKEN_EXPIRY_SECONDS).`,
  );
  console.log(
    '  4. Drop the OLD kid from JWT_PUBLIC_KEYS only AFTER that TTL window elapses. ' +
      '(Single-key deploys without JWT_PUBLIC_KEYS instead accept a short 401 burst.)',
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
  printOverlapWindowSnippet({ keyPair, options });

  if (options.apply) {
    applyViaGhSecretSet({ keyPair, options });
  } else {
    printSyncSnippet({ keyPair, options });
  }

  printRotationChecklist();
}

main();
