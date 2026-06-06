import { randomBytes } from 'node:crypto';
import i18next from 'i18next';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import { emitWebhookDeliveryRequested } from '@/domains/notify/sub-domains/webhook/webhook-delivery/events/webhook-delivery-emit.js';
import type { WebhookRepository } from './webhook.repository.js';
import type { WebhookDeliveryAttemptRepository } from './webhook-delivery/webhook-delivery-attempt.repository.js';
import { WebhookSerializer } from './webhook.serializer.js';
import { validateCreateWebhook, validateUpdateWebhook } from './webhook.validator.js';
import {
  decryptFieldSecret,
  encryptFieldSecret,
} from '@/shared/utils/security/field-secret-encryption.util.js';
import {
  createPinnedWebhookFetch,
  resolveAndPinWebhookUrl,
} from '@/shared/utils/security/webhook-outbound-fetch.util.js';
import { invalidateWebhookOutboundCircuit } from '@/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-outbound-circuit.js';
import { buildOutboundFetchOptions, outboundFetch } from '@/infrastructure/outbound/index.js';
import { buildWebhookSignatureHeader } from '@/shared/utils/security/webhook-signature.util.js';
import { ConflictError, NotFoundError } from '@/shared/errors/index.js';
import { isPostgresUniqueViolation } from '@/shared/utils/infrastructure/postgres-error.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { safeWebhookUrlForLogs } from '@/shared/utils/security/safe-webhook-url-for-logs.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import { WEBHOOK_ORGANIZATION_FANOUT_CONCURRENCY } from '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery.constants.js';
import { PAGINATION } from '@/shared/constants/pagination.constants.js';
import { env } from '@/shared/config/env.config.js';

/** Maximum response body length returned to client (prevents leaking sensitive data from target) */
const WEBHOOK_TEST_RESPONSE_BODY_MAX_LENGTH = 500;
/** Maximum response body length persisted to the delivery-attempt record (bounds storage growth). */
const WEBHOOK_TEST_RESPONSE_BODY_STORED_MAX_LENGTH = 2_000;

/**
 * Number of CSPRNG bytes used when auto-generating a webhook signing secret. 32 bytes →
 * 64 hex chars (well clear of the DTO's 16-char minimum) → 256 bits of entropy. Far above
 * any practical brute-force threat against the HMAC-SHA256 signature.
 */
const AUTO_GENERATED_WEBHOOK_SECRET_BYTES = 32;

/**
 * Generate a fresh webhook signing secret when the caller did not supply one. sec-UP
 * finding #8: a missing/empty secret previously round-tripped through
 * `decryptFieldSecret('')` and produced a deterministic, attacker-reproducible
 * `X-Webhook-Signature`. Auto-generating closes the empty-key path while preserving the
 * ergonomic "the platform manages the secret" UX.
 */
function generateWebhookSigningSecret(): string {
  return randomBytes(AUTO_GENERATED_WEBHOOK_SECRET_BYTES).toString('hex');
}

/**
 * Options forwarded from controllers into {@link WebhookService.list}.
 *
 * @remarks
 * - **Algorithm:** consumed by the repository keyset-pagination layer.
 * - **Failure modes:** invalid `after` cursors raise inside the repository.
 * - **Side effects:** none (read-only).
 * - **Notes:** organization scoping is enforced via `withOrganizationDatabaseContext`.
 */
export interface WebhookListOptions {
  organization_public_id: string;
  after?: string;
  limit?: number;
  include_total?: boolean;
}

/**
 * Options for {@link WebhookService.listDeliveryAttempts} — extends {@link WebhookListOptions}
 * with the public id of the webhook whose delivery attempts to return.
 *
 * @remarks
 * - **Algorithm:** the service resolves `(webhook_public_id, organization_id)` to an internal
 *   webhook id before paging, so callers cannot list attempts across organizations.
 * - **Failure modes:** unknown webhook → `NotFoundError`.
 * - **Side effects:** none (read-only).
 * - **Notes:** delivery attempts are immutable; this is purely an audit list.
 */
export interface WebhookDeliveryAttemptListOptions extends WebhookListOptions {
  webhook_public_id: string;
}

/**
 * Application-layer service for webhook configuration and outbound delivery.
 *
 * @remarks
 * - **Algorithm:** every read/write runs inside `withOrganizationDatabaseContext` so Postgres
 *   RLS pins access to the requesting organization. Mutations validate the URL via the SSRF /
 *   allowlist guard, encrypt the secret (`encryptFieldSecret`), and serialise responses through
 *   {@link WebhookSerializer} so secrets never leak. `requestWebhookDelivery` persists a
 *   `PENDING` attempt and emits `NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED` for the worker to
 *   pick up post-commit. `dispatchOrganizationWebhooks` fans out one event to every enabled
 *   webhook subscribed to that event type. `testWebhook` performs a live signed POST in two
 *   phases — DB lookup, then network call, then audit-trail insert — pinning DNS to a single
 *   SSRF-validated address before sending and capping the persisted body to 2 KB.
 * - **Failure modes:** `NotFoundError` for missing webhook/organization; `ValidationError` from
 *   the URL/Zod validators; outbound HTTP errors are recorded on the attempt and surfaced to
 *   the caller for the test endpoint.
 * - **Side effects:** Postgres reads/writes against `notify.webhooks` and
 *   `notify.webhook_delivery_attempts`; in-process event-bus emit; outbound HTTPS calls for
 *   the test endpoint.
 * - **Notes:** never log decrypted secrets; never bypass the URL validator on update; the
 *   serializer strip-list is the last defence and must stay in sync with new secret fields.
 */
export class WebhookService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly webhookRepository: WebhookRepository,
    private readonly deliveryAttemptRepository: WebhookDeliveryAttemptRepository,
  ) {}

  async list(options: WebhookListOptions) {
    const { organization_public_id } = options;
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const result = await this.webhookRepository.listByOrganization(
        organization.id,
        omitUndefined({
          after: options.after,
          limit: options.limit ?? PAGINATION.DEFAULT_LIMIT,
          include_total: options.include_total,
        }),
      );
      return {
        ...result,
        items: WebhookSerializer.many(result.items),
      };
    });
  }

  async get(organization_public_id: string, webhook_public_id: string) {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const webhook = await this.webhookRepository.findByPublicId(
        webhook_public_id,
        organization.id,
      );
      if (!webhook) throw new NotFoundError('Webhook');
      return WebhookSerializer.one(webhook);
    });
  }

  async create(
    organization_public_id: string,
    body: unknown,
    created_by_user_public_id: string | undefined,
  ) {
    const parsed = validateCreateWebhook(body);
    await resolveAndPinWebhookUrl(parsed.url);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      // sec-N4: enforce the per-organization webhook cap before insert. Race-
      // safe enough for a stability cap (the per-route rate limit bounds
      // concurrency); intentionally not a DB constraint because the failure
      // mode of two parallel inserts both passing at N-1 is "one extra row,"
      // not security-critical. A future hardening could add a partial
      // composite unique to make this transactional.
      const activeCount = await this.webhookRepository.countActiveByOrganization(organization.id);
      if (activeCount >= env.WEBHOOK_MAX_PER_ORG) {
        throw new ConflictError('errors:webhookMaxReached', {
          max: env.WEBHOOK_MAX_PER_ORG,
        });
      }
      const userId =
        await this.organizationService.resolveUserInternalIdByPublicId(created_by_user_public_id);
      // sec-UP #8: never persist an empty webhook secret. The DTO already refuses
      // empty/short strings at the boundary; when the caller omits `secret`
      // entirely (the "let the platform pick one" UX), generate a 256-bit CSPRNG
      // value so the worker's HMAC always has a real key.
      const effectiveSecret = parsed.secret ?? generateWebhookSigningSecret();
      const row = await this.webhookRepository.create(
        omitUndefined({
          organization_id: organization.id,
          url: parsed.url,
          encrypted_secret: encryptFieldSecret(effectiveSecret),
          events: parsed.events,
          is_enabled: parsed.is_enabled,
          created_by_user_id: userId ?? undefined,
        }),
      );
      return WebhookSerializer.one(row);
    });
  }

  async update(
    organization_public_id: string,
    webhook_public_id: string,
    body: unknown,
    updated_by_user_public_id: string | undefined,
  ) {
    const parsed = validateUpdateWebhook(body);
    if (parsed.url !== undefined) {
      await resolveAndPinWebhookUrl(parsed.url);
    }
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const userId =
        await this.organizationService.resolveUserInternalIdByPublicId(updated_by_user_public_id);
      const updatePayload = omitUndefined({
        url: parsed.url,
        events: parsed.events,
        is_enabled: parsed.is_enabled,
        encrypted_secret:
          parsed.secret !== undefined ? encryptFieldSecret(parsed.secret) : undefined,
      });
      let updated: Awaited<ReturnType<WebhookRepository['update']>>;
      try {
        updated = await this.webhookRepository.update(
          webhook_public_id,
          organization.id,
          updatePayload,
          userId ?? undefined,
        );
      } catch (error) {
        // A URL change that collides with another webhook in the same organization
        // hits idx_webhooks_organization_id_url_unique — surface it as a clean 409.
        if (isPostgresUniqueViolation(error)) {
          throw new ConflictError(
            'errors:webhookUrlExists',
            parsed.url ? { url: parsed.url } : undefined,
          );
        }
        throw error;
      }
      if (!updated) throw new NotFoundError('Webhook');
      // Best-effort: drop any cached breaker so a URL/secret change does not reuse stale state.
      // Cross-process delivery workers fall back to the breaker cache's idle TTL.
      invalidateWebhookOutboundCircuit(updated.id);
      return WebhookSerializer.one(updated);
    });
  }

  async delete(organization_public_id: string, webhook_public_id: string) {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const deleted = await this.webhookRepository.softDelete(webhook_public_id, organization.id);
      if (!deleted) throw new NotFoundError('Webhook');
      // Best-effort: drop any cached breaker for the removed webhook (idle TTL covers other processes).
      invalidateWebhookOutboundCircuit(deleted.id);
    });
  }

  /**
   * Request async HTTP delivery for a webhook event (persist attempt + event bus → Redis queue).
   */
  async requestWebhookDelivery(input: {
    webhookId: number;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await emitWebhookDeliveryRequested(input);
  }

  /**
   * Deliver an organization-scoped billing event to all subscribed enabled webhooks.
   *
   * @remarks
   * - **Algorithm:** load subscribed enabled endpoints, then fan delivery requests
   *   out in bounded-concurrency batches of {@link WEBHOOK_ORGANIZATION_FANOUT_CONCURRENCY}
   *   so a large subscriber list cannot serialize into N sequential round-trips.
   * - **Failure modes:** per-webhook failures are isolated (best-effort) and logged;
   *   if every dispatch in the fan-out fails, the first error is rethrown so the
   *   caller (event handler / worker) can retry the whole event.
   * - **Side effects:** persists one PENDING delivery attempt per webhook and emits
   *   `WEBHOOK_DELIVERY_REQUESTED` for each (enqueued post-commit).
   */
  async dispatchOrganizationWebhooks(
    organization_id: number,
    event_type: string,
    payload: Record<string, unknown>,
    _requestId?: string,
  ): Promise<void> {
    // sec-N4: defense-in-depth backstop — share the same per-org cap with create().
    // If we ever load >= cap rows the create cap and runtime list have drifted
    // OR an operator just lifted the cap; surface the truncation so an alert
    // can fire (Sentry log warnings, ops dashboard).
    const fanoutCap = env.WEBHOOK_MAX_PER_ORG;
    const webhooks = await this.webhookRepository.listEnabledSubscribedToEvent(
      organization_id,
      event_type,
      undefined,
      fanoutCap,
    );
    if (webhooks.length >= fanoutCap) {
      logger.warn(
        { organizationId: organization_id, eventType: event_type, fanoutCap },
        'notify.webhook.fanout.cap_reached',
      );
    }
    if (webhooks.length === 0) return;

    let firstError: unknown;
    let failureCount = 0;
    for (let index = 0; index < webhooks.length; index += WEBHOOK_ORGANIZATION_FANOUT_CONCURRENCY) {
      const batch = webhooks.slice(index, index + WEBHOOK_ORGANIZATION_FANOUT_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((webhook) =>
          this.requestWebhookDelivery({
            webhookId: webhook.id,
            eventType: event_type,
            payload,
          }),
        ),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          failureCount += 1;
          if (firstError === undefined) firstError = result.reason;
          logger.warn(
            { error: result.reason, organizationId: organization_id, eventType: event_type },
            'notify.webhook.fanout.deliveryRequestFailed',
          );
        }
      }
    }

    // Only surface an error when every endpoint failed — a single bad endpoint must
    // not block delivery to the others, but a total failure should be retryable.
    if (failureCount === webhooks.length && firstError !== undefined) {
      throw firstError;
    }
  }

  async listDeliveryAttempts(options: WebhookDeliveryAttemptListOptions) {
    const { organization_public_id, webhook_public_id } = options;
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const webhookId = await this.deliveryAttemptRepository.getWebhookId(
        webhook_public_id,
        organization.id,
      );
      if (webhookId === null || webhookId === undefined) throw new NotFoundError('Webhook');
      return this.deliveryAttemptRepository.listByWebhook(
        webhookId,
        omitUndefined({
          after: options.after,
          limit: options.limit ?? PAGINATION.DEFAULT_LIMIT,
          include_total: options.include_total,
        }),
      );
    });
  }

  async testWebhook(options: {
    organization_public_id: string;
    webhook_public_id: string;
    requestId?: string;
  }) {
    const { organization_public_id, webhook_public_id, requestId } = options;
    // Phase 1 (DB context): resolve the webhook under RLS scope.
    const webhook = await withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const found = await this.webhookRepository.findByPublicId(webhook_public_id, organization.id);
      if (!found) throw new NotFoundError('Webhook');
      return found;
    });

    // Pins DNS to a single SSRF-validated resolution and enforces the production allowlist.
    // Throws ValidationError (4xx) before any attempt is recorded if the URL is now unsafe —
    // closing the DNS-rebinding window that raw fetch(webhook.url) would otherwise leave open.
    const pinnedFetch = await createPinnedWebhookFetch(webhook.url);

    const testPayload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: {
        webhook_id: webhook.public_id,
        message: i18next.t('success:webhookTestDelivery', { lng: 'en' }),
      },
    };
    const payloadString = JSON.stringify(testPayload);
    const signatureTimestamp = Math.floor(Date.now() / 1000);
    const signatureHeader = buildWebhookSignatureHeader(
      decryptFieldSecret(webhook.encrypted_secret),
      payloadString,
      signatureTimestamp,
    );

    const sentAt = new Date();
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      const response = await outboundFetch(
        buildOutboundFetchOptions({
          name: 'webhook-test',
          url: webhook.url,
          requestId,
          fetchImplementation: pinnedFetch,
          init: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'core-be-webhook/1.0',
              'X-Webhook-Event': 'webhook.test',
              'X-Webhook-Signature': signatureHeader,
              'X-Webhook-Timestamp': String(signatureTimestamp),
            },
            body: payloadString,
          },
        }),
      );
      statusCode = response.status;
      try {
        // The pinned fetch enforces WEBHOOK_RESPONSE_BODY_MAX_BYTES while streaming, so a hostile
        // target cannot OOM this path before we further truncate the persisted/returned body.
        responseBody = await response.text();
      } catch (parseError) {
        logger.warn(
          {
            webhookId: webhook.public_id,
            ...safeWebhookUrlForLogs(webhook.url),
            parseError: parseError instanceof Error ? parseError.message : 'Unknown error',
          },
          'webhook.response.body.parse.failed',
        );
        responseBody = '[parse error]';
      }
      success = response.ok;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      responseBody = errorMessage;
      logger.warn(
        {
          webhookId: webhook.public_id,
          ...safeWebhookUrlForLogs(webhook.url),
          error: errorMessage,
        },
        'webhook.test.delivery.failed',
      );
    }

    // Cap the persisted body so a hostile target cannot bloat storage with a huge response.
    const storedResponseBody =
      responseBody !== null && responseBody.length > WEBHOOK_TEST_RESPONSE_BODY_STORED_MAX_LENGTH
        ? responseBody.slice(0, WEBHOOK_TEST_RESPONSE_BODY_STORED_MAX_LENGTH)
        : responseBody;

    // Phase 2 (DB context): record the delivery attempt under RLS scope (network already done).
    await withOrganizationDatabaseContext(organization_public_id, async () => {
      await this.deliveryAttemptRepository.create({
        webhook_id: webhook.id,
        event_type: 'webhook.test',
        payload: testPayload,
        status: success ? 'SENT' : 'FAILED',
        http_status_code: statusCode,
        response_body: storedResponseBody,
        sent_at: sentAt,
        attempt_count: 1,
      });
    });

    const truncatedBody =
      responseBody !== null &&
      responseBody !== undefined &&
      responseBody.length > WEBHOOK_TEST_RESPONSE_BODY_MAX_LENGTH
        ? `${responseBody.slice(0, WEBHOOK_TEST_RESPONSE_BODY_MAX_LENGTH)}... [truncated]`
        : responseBody;

    return {
      success,
      status_code: statusCode,
      delivered_at: sentAt.toISOString(),
      response_body: truncatedBody,
    };
  }
}
