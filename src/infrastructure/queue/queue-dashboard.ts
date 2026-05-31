import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { FastifyAdapter } from '@bull-board/fastify';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { AUDIT_RETENTION_QUEUE_NAME } from '@/domains/audit/workers/audit-retention.constants.js';
import type { AuditService } from '@/domains/audit/audit.service.js';
import { SESSION_CLEANUP_QUEUE_NAME } from '@/domains/auth/sub-domains/auth-session/workers/session-cleanup.constants.js';
import { NOTIFICATION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/webhook-delivery/queues/webhook-delivery.queue.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { listDeadLetterQueueNames } from '@/infrastructure/queue/dlq/dead-letter.js';
import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { WEBHOOK_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/workers/webhook-tombstone-retention.constants.js';
import { ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/workers/organization-notification-policy-tombstone-retention.constants.js';
import { USER_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/user/workers/user-tombstone-retention.constants.js';
import { ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/organization/workers/organization-tombstone-retention.constants.js';
import { MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/membership/workers/membership-tombstone-retention.constants.js';
import { MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/member-roles/workers/member-role-tombstone-retention.constants.js';
import { ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/organization/organization-api-key/workers/organization-api-key-tombstone-retention.constants.js';
import { UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/upload/workers/upload-tombstone-retention.constants.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { IDEMPOTENCY_CARDINALITY_QUEUE_NAME } from '@/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.constants.js';
import { DLQ_DEPTH_QUEUE_NAME } from '@/infrastructure/observability/dlq-depth/dlq-depth.constants.js';
import { getEnv } from '@/shared/config/env.config.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { GLOBAL_ROLES } from '@/shared/constants/index.js';
import { requireRole } from '@/shared/utils/auth/authorization.util.js';
const SOURCE_QUEUE_NAMES = [
  MAIL_QUEUE_NAME,
  WEBHOOK_DELIVERY_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  AUDIT_RETENTION_QUEUE_NAME,
  SESSION_CLEANUP_QUEUE_NAME,
  WEBHOOK_TOMBSTONE_RETENTION_QUEUE_NAME,
  ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_QUEUE_NAME,
  USER_TOMBSTONE_RETENTION_QUEUE_NAME,
  ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME,
  MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME,
  MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME,
  ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME,
  UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME,
  STRIPE_WEBHOOK_QUEUE_NAME,
  IDEMPOTENCY_CARDINALITY_QUEUE_NAME,
  DLQ_DEPTH_QUEUE_NAME,
] as const;

const QUEUE_NAMES = [
  ...SOURCE_QUEUE_NAMES,
  ...listDeadLetterQueueNames(SOURCE_QUEUE_NAMES),
] as const;

const DASHBOARD_PREFIX = '/admin/queues';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Structured representation of a write-side Bull Board API call (pause, resume, retry,
 * clean, …) destined for `audit.logs`. Produced by `parseQueueDashboardMutation` and
 * consumed by the dashboard's `onResponse` hook so every SUPER_ADMIN action against the
 * queue dashboard leaves a tamper-evident trail.
 */
export interface QueueDashboardMutationAudit {
  action: string;
  queueName?: string;
  jobId?: string;
  extraMetadata?: Record<string, unknown>;
}

type DashboardMutationRule = {
  methods: readonly string[];
  pattern: RegExp;
  build: (match: RegExpExecArray) => QueueDashboardMutationAudit;
};

const DASHBOARD_MUTATION_RULES: DashboardMutationRule[] = [
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/pause$/,
    build: () => ({ action: 'queue.pause_all' }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/resume$/,
    build: () => ({ action: 'queue.resume_all' }),
  },
  {
    methods: ['PATCH'],
    pattern: /^\/api\/queues\/([^/]+)\/([^/]+)\/update-data$/,
    build: (match) => ({
      action: 'queue.job.update_data',
      queueName: match[1]!,
      jobId: match[2]!,
    }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/([^/]+)\/retry$/,
    build: (match) => ({
      action: 'queue.job.retry',
      queueName: match[1]!,
      jobId: match[2]!,
    }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/([^/]+)\/clean$/,
    build: (match) => ({
      action: 'queue.job.clean',
      queueName: match[1]!,
      jobId: match[2]!,
    }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/([^/]+)\/promote$/,
    build: (match) => ({
      action: 'queue.job.promote',
      queueName: match[1]!,
      jobId: match[2]!,
    }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/clean\/([^/]+)$/,
    build: (match) => ({
      action: 'queue.clean',
      queueName: match[1]!,
      extraMetadata: { queueStatus: match[2]! },
    }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/retry\/([^/]+)$/,
    build: (match) => ({
      action: 'queue.retry',
      queueName: match[1]!,
      extraMetadata: { queueStatus: match[2]! },
    }),
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/queues\/([^/]+)\/add$/,
    build: (match) => ({ action: 'queue.job.add', queueName: match[1]! }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/promote$/,
    build: (match) => ({ action: 'queue.promote', queueName: match[1]! }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/pause$/,
    build: (match) => ({ action: 'queue.pause', queueName: match[1]! }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/resume$/,
    build: (match) => ({ action: 'queue.resume', queueName: match[1]! }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/concurrency$/,
    build: (match) => ({ action: 'queue.concurrency', queueName: match[1]! }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/empty$/,
    build: (match) => ({ action: 'queue.empty', queueName: match[1]! }),
  },
  {
    methods: ['PUT'],
    pattern: /^\/api\/queues\/([^/]+)\/obliterate$/,
    build: (match) => ({ action: 'queue.obliterate', queueName: match[1]! }),
  },
];

/**
 * Maps a Bull Board API path (under /admin/queues) and HTTP method to an audit action.
 * Returns null when the request should not be audited (e.g. read-only).
 */
export function parseQueueDashboardMutation(
  pathname: string,
  method: string,
): QueueDashboardMutationAudit | null {
  if (!MUTATING_METHODS.has(method)) return null;
  if (!pathname.startsWith(DASHBOARD_PREFIX)) return null;
  const relativePath = pathname.slice(DASHBOARD_PREFIX.length);
  if (!relativePath.startsWith('/api/')) return null;

  for (const rule of DASHBOARD_MUTATION_RULES) {
    if (!rule.methods.includes(method)) continue;
    const match = rule.pattern.exec(relativePath);
    if (match) return rule.build(match);
  }
  return { action: 'queue.unknown' };
}

/**
 * DI surface for {@link registerQueueDashboard}. The `auditService` is invoked from the
 * dashboard's `onResponse` hook to persist {@link QueueDashboardMutationAudit} entries
 * whenever a mutating Bull Board call returns a 2xx response.
 */
export interface RegisterQueueDashboardDeps {
  auditService: AuditService;
}

/**
 * Registers the Bull Board queue dashboard at /admin/queues.
 * Protected by JWT + requireRole(SUPER_ADMIN).
 * Mutating Bull Board API calls (2xx) are written to audit.logs.
 * Only registered when ENABLE_QUEUE_DASHBOARD is true.
 */
export async function registerQueueDashboard(
  app: FastifyInstance,
  deps: RegisterQueueDashboardDeps,
): Promise<void> {
  const connectionOptions = getBullMQConnectionOptions();
  const queues = QUEUE_NAMES.map((name) => new Queue(name, { connection: connectionOptions }));
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath(DASHBOARD_PREFIX);

  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter,
  });

  const adminPreHandler = [app.authenticate, requireRole(GLOBAL_ROLES.SUPER_ADMIN)] as const;

  await app.register(
    async (scope) => {
      scope.addHook('preHandler', async (request, reply) => {
        for (const handler of adminPreHandler) {
          await handler.call(scope, request, reply);
        }
        if (!getEnv().ENABLE_QUEUE_DASHBOARD_MUTATIONS && MUTATING_METHODS.has(request.method)) {
          throw new UnauthorizedError('errors:queueDashboardReadOnly');
        }
      });

      scope.addHook('onResponse', async (request, reply) => {
        try {
          if (reply.statusCode < 200 || reply.statusCode >= 300) return;

          const pathname = (request.url.split('?')[0] ?? '') as string;
          const parsed = parseQueueDashboardMutation(pathname, request.method);
          if (!parsed) return;

          const userAgent = request.headers['user-agent'] ?? null;

          const actorUserPublicId = request.auth?.userId;
          if (!actorUserPublicId) return;

          await deps.auditService.record({
            actorUserPublicId,
            action: parsed.action,
            resource_type: 'queue',
            ip_address: request.ip,
            user_agent: userAgent,
            metadata: {
              queue: parsed.queueName,
              jobId: parsed.jobId,
              method: request.method,
              url: pathname,
              ...parsed.extraMetadata,
            },
          });
        } catch (error) {
          request.log.warn({ error }, 'queueDashboard.auditWriteFailed');
        }
      });

      await scope.register(serverAdapter.registerPlugin());
    },
    { prefix: DASHBOARD_PREFIX },
  );
}
