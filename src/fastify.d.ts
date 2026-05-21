import 'fastify';
import type { TFunction, i18n } from 'i18next';
import type { AuditContainer } from '@/domains/audit/audit.container.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';
import type { BillingContainer } from '@/domains/billing/billing.container.js';
import type { NotifyContainer } from '@/domains/notify/notify.container.js';
import type { TenancyContainer } from '@/domains/tenancy/tenancy.container.js';
import type { UploadContainer } from '@/domains/upload/upload.container.js';
import type { UserContainer } from '@/domains/user/user.container.js';
import type { AuthContext } from '@/shared/types/index.js';
import type { FastifyReply } from 'fastify';
import type Stripe from 'stripe';

declare module 'fastify' {
  interface FastifyContextConfig {
    idempotencyRequired?: boolean;
  }

  interface FastifyRequest {
    auth: AuthContext | null;
    organizationId: string | null;
    rawBody: Buffer | undefined;
    /** Set by stripe webhook ingress plugin after signature verification. */
    stripeWebhookEvent?: Stripe.Event;
    metricsStartTimeNanoseconds?: bigint;
    /** i18n translate function (set by i18n middleware when not on ignoreRoutes). */
    t?: TFunction;
    /** Detected language code (e.g. "en", "es"). */
    language?: string;
    /** Resolved language hierarchy. */
    languages?: string[];
    /** i18n instance for this request (clone). */
    i18n?: i18n;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Wired by domain `register*Container` functions via `domainContainersPlugin`. */
    userDomain: UserContainer;
    tenancyDomain: TenancyContainer;
    auditDomain: AuditContainer;
    authDomain: AuthContainer;
    billingDomain: BillingContainer;
    notifyDomain: NotifyContainer;
    uploadDomain: UploadContainer;
  }
}
