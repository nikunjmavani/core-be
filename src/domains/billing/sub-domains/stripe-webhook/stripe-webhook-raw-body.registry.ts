/**
 * Live registry of route URLs that must capture the raw HTTP body for Stripe HMAC
 * verification (sec-B finding #7).
 *
 * @remarks
 * Prior to this fix, the content-type parser in `src/app.ts` checked a hardcoded
 * `Set<string>` of webhook paths. Two files had to stay in lockstep on the *exact*
 * URLs or every signature verification silently failed for the 3-day Stripe retry
 * window — and the `JSON.stringify` fallback in the ingress plugin masked the
 * misconfiguration as "every webhook is rejected" rather than "wiring drifted."
 *
 * The Stripe webhook routes module populates this set at registration time via its
 * `onRoute` hook. The content-type parser reads from the set on every request, so a
 * rename / restructure of the webhook URL is reflected automatically. A positive
 * integration test asserts that the configured URLs end up in this set.
 */
const rawBodyRouteUrls = new Set<string>();

/**
 * Called by the Stripe webhook routes module at registration time (via its `onRoute`
 * hook) for every route whose `routeOptions.config.captureRawBody === true`. Adds
 * the route URL — already prefix-applied by Fastify — to the registry the content-
 * type parser reads from on every request.
 */
export function registerStripeWebhookRawBodyRoute(url: string): void {
  rawBodyRouteUrls.add(url);
}

/**
 * Called by the content-type parser in `src/app.ts` to decide whether to capture the
 * raw HTTP body buffer on `request.rawBody` for a given URL. Returns true only for
 * URLs that were declared with `config.captureRawBody = true` at route registration.
 */
export function isStripeWebhookRawBodyRoute(url: string): boolean {
  return rawBodyRouteUrls.has(url);
}

/** Returns a snapshot of the current set — for tests and the boot-time sanity log only. */
export function listStripeWebhookRawBodyRoutes(): readonly string[] {
  return Array.from(rawBodyRouteUrls);
}
