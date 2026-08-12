/**
 * Provider gating for the live contract slice (`pnpm test:contract:live`).
 *
 * The offline contract tier replays committed fixtures with the network disabled, so it can
 * never notice a provider changing its API. This slice calls the same wrappers against the
 * real sandbox endpoints and validates the responses with the same Zod contracts.
 *
 * @remarks
 * - **Opting in is explicit, never inferred.** A provider runs only when it is *named* in
 *   `CONTRACT_LIVE_PROVIDERS`. Credential presence alone is deliberately not enough: a
 *   developer `.env.local` routinely carries placeholder `sk_test_…` / `re_…` values, and an
 *   earlier version of this gate fired real Stripe calls off one. Naming a provider is also
 *   how you accept its side effects — Resend sends real mail, S3 writes and deletes objects.
 * - **Safety:** `sk_live_` is refused outright, so this can never point at production Stripe.
 * - **Never in CI:** excluded from `pnpm test` and every workflow. Run it on demand when you
 *   want to know whether a provider drifted.
 */

/** Master switch — set by the `test:contract:live` script. */
function isLiveContractRunEnabled(): boolean {
  return process.env.CONTRACT_LIVE === 'true' || process.env.CONTRACT_LIVE === '1';
}

/** Providers explicitly opted in via `CONTRACT_LIVE_PROVIDERS` (comma-separated). */
function optedInProviders(): Set<string> {
  return new Set(
    (process.env.CONTRACT_LIVE_PROVIDERS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isProviderOptedIn(provider: string): boolean {
  return isLiveContractRunEnabled() && optedInProviders().has(provider);
}

/** Stripe test-mode key. `sk_live_` is refused: this slice creates and deletes real objects. */
export function hasStripeLiveCredentials(): boolean {
  if (!isProviderOptedIn('stripe')) return false;
  return process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') === true;
}

/** Resend key, a verified sender, and a recipient — a run sends real mail. */
export function hasResendLiveCredentials(): boolean {
  if (!isProviderOptedIn('resend')) return false;
  return (
    process.env.RESEND_API_KEY?.startsWith('re_') === true &&
    Boolean(process.env.EMAIL_FROM_ADDRESS) &&
    Boolean(process.env.CONTRACT_LIVE_EMAIL_TO)
  );
}

/** The throwaway inbox the live Resend check delivers to. */
export function liveEmailRecipient(): string {
  const recipient = process.env.CONTRACT_LIVE_EMAIL_TO;
  if (!recipient) throw new Error('CONTRACT_LIVE_EMAIL_TO is required for the live Resend check');
  return recipient;
}

/** S3 credentials — the run writes and deletes objects, so prefer a throwaway bucket or MinIO. */
export function hasS3LiveCredentials(): boolean {
  if (!isProviderOptedIn('s3')) return false;
  return (
    Boolean(process.env.S3_BUCKET) &&
    Boolean(process.env.S3_REGION) &&
    Boolean(process.env.S3_ACCESS_KEY_ID) &&
    Boolean(process.env.S3_SECRET_ACCESS_KEY)
  );
}

/** Turnstile secret. Cloudflare publishes fixed testing secrets, so this needs no account. */
export function hasTurnstileLiveCredentials(): boolean {
  if (!isProviderOptedIn('turnstile')) return false;
  return process.env.CAPTCHA_PROVIDER === 'turnstile' && Boolean(process.env.CAPTCHA_SECRET);
}

/** Why a provider slice did not run — surfaced by the skipped-branch spec in each file. */
export function describeSkipReason(provider: string): string {
  if (!isLiveContractRunEnabled()) {
    return `${provider}: CONTRACT_LIVE is not set — run via pnpm test:contract:live`;
  }
  if (!optedInProviders().has(provider)) {
    return `${provider}: not listed in CONTRACT_LIVE_PROVIDERS`;
  }
  return `${provider}: opted in, but its credentials are incomplete or not test-mode`;
}
