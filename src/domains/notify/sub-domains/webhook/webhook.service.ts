import i18next from 'i18next';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import { emitWebhookDeliveryRequested } from '@/domains/notify/sub-domains/webhook/events/webhook-delivery-emit.js';
import type { WebhookRepository } from './webhook.repository.js';
import type { WebhookDeliveryAttemptRepository } from './webhook-delivery-attempt.repository.js';
import { WebhookSerializer } from './webhook.serializer.js';
import { validateCreateWebhook, validateUpdateWebhook } from './webhook.validator.js';
import {
  decryptFieldSecret,
  encryptFieldSecret,
} from '@/shared/utils/security/field-secret-encryption.util.js';
import { validateWebhookUrl } from '@/shared/utils/security/webhook-url.util.js';
import { buildOutboundFetchOptions, outboundFetch } from '@/infrastructure/outbound/index.js';
import { createPinnedWebhookFetch } from '@/shared/utils/security/webhook-outbound-fetch.util.js';
import { buildWebhookSignatureHeader } from '@/shared/utils/security/webhook-signature.util.js';
import { NotFoundError } from '@/shared/errors/index.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import { PAGINATION } from '@/shared/constants/pagination.constants.js';

/** Maximum response body length returned to client (prevents leaking sensitive data from target) */
const WEBHOOK_TEST_RESPONSE_BODY_MAX_LENGTH = 500;
/** Maximum response body length persisted to the delivery-attempt record (bounds storage growth). */
const WEBHOOK_TEST_RESPONSE_BODY_STORED_MAX_LENGTH = 2_000;

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

  async create(organization_public_id: string, body: unknown, created_by_user_public_id: string) {
    const parsed = validateCreateWebhook(body);
    await validateWebhookUrl(parsed.url);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const userId =
        await this.organizationService.resolveUserInternalIdByPublicId(created_by_user_public_id);
      const row = await this.webhookRepository.create(
        omitUndefined({
          organization_id: organization.id,
          url: parsed.url,
          encrypted_secret: encryptFieldSecret(parsed.secret ?? ''),
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
    updated_by_user_public_id: string,
  ) {
    const parsed = validateUpdateWebhook(body);
    if (parsed.url !== undefined) {
      await validateWebhookUrl(parsed.url);
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
      const updated = await this.webhookRepository.update(
        webhook_public_id,
        organization.id,
        updatePayload,
        userId ?? undefined,
      );
      if (!updated) throw new NotFoundError('Webhook');
      return WebhookSerializer.one(updated);
    });
  }

  async delete(organization_public_id: string, webhook_public_id: string) {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const deleted = await this.webhookRepository.softDelete(webhook_public_id, organization.id);
      if (!deleted) throw new NotFoundError('Webhook');
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
   */
  async dispatchOrganizationWebhooks(
    organization_id: number,
    event_type: string,
    payload: Record<string, unknown>,
    _requestId?: string,
  ): Promise<void> {
    const webhooks = await this.webhookRepository.listEnabledSubscribedToEvent(
      organization_id,
      event_type,
    );
    for (const webhook of webhooks) {
      await this.requestWebhookDelivery({
        webhookId: webhook.id,
        eventType: event_type,
        payload,
      });
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
        responseBody = await response.text();
      } catch (parseError) {
        logger.warn(
          {
            webhookId: webhook.public_id,
            url: webhook.url,
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
        { webhookId: webhook.public_id, url: webhook.url, error: errorMessage },
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
