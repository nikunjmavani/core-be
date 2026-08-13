/**
 * Setup for the live contract slice (`pnpm test:contract:live`).
 *
 * Deliberately NOT `src/tests/setup.ts`: under `CONTRACT_TESTS_ENABLED` that file
 * **hard-overwrites** `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, and every S3 variable with
 * placeholders — correct for the offline tier, fatal here. It also activates nock and mocks
 * Redis, and this slice exists to make real calls.
 *
 * @remarks
 * **Why the platform snapshot below exists.** A live run wants the credentials the *platform*
 * injected (cloud environment settings, CI secrets, an operator's shell). Two behaviours in
 * `load-env-files` otherwise destroy them, and both are correct for the application:
 *
 * 1. When `NODE_ENV` is a deploy target, the machine-local file is layered on with
 *    `override: true`, so its placeholder `sk_test_xxx` beats a real injected key.
 * 2. A key written blank in that file (`CAPTCHA_SECRET=`) is *deleted* from `process.env`
 *    regardless of override, so an injected value disappears entirely.
 *
 * Both are right for running the app — a developer's machine-local file should win. Neither is
 * right for a live contract check, where the injected credential is the whole point. So we
 * snapshot the injected values first and restore them after the loader runs. Only the
 * provider-credential keys are restored; everything else loads normally.
 */
const PLATFORM_CREDENTIAL_KEYS = [
  'STRIPE_SECRET_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM_ADDRESS',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'CAPTCHA_SECRET',
] as const;

const platformInjected = new Map<string, string>();
for (const key of PLATFORM_CREDENTIAL_KEYS) {
  const value = process.env[key];
  if (value !== undefined && value !== '') platformInjected.set(key, value);
}

await import('@/shared/config/load-env-files.js');

for (const [key, value] of platformInjected) {
  process.env[key] = value;
}
