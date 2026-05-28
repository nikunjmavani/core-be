import type { FastifyInstance } from 'fastify';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import { registerNotifyEventHandlers } from './events/notify.event-handlers.js';
import {
  configureNotificationDispatch,
  createNotificationDispatch,
} from './sub-domains/notification/notification-dispatch.service.js';
import { NotificationRepository } from './sub-domains/notification/notification.repository.js';
import { WebhookRepository } from './sub-domains/webhook/webhook.repository.js';
import { WebhookDeliveryAttemptRepository } from './sub-domains/webhook/webhook-delivery-attempt.repository.js';
import { WebhookEventRepository } from './sub-domains/webhook/webhook-event/webhook-event.repository.js';
import { NotificationService } from './sub-domains/notification/notification.service.js';
import { WebhookService } from './sub-domains/webhook/webhook.service.js';
import { WebhookEventService } from './sub-domains/webhook/webhook-event/webhook-event.service.js';

/**
 * Public surface of the notify domain container — services and repositories the rest of the
 * application is allowed to consume (decorated onto Fastify as `app.notifyDomain`).
 */
export type NotifyContainer = {
  notificationService: NotificationService;
  webhookService: WebhookService;
  webhookEventService: WebhookEventService;
  webhookDeliveryAttemptRepository: WebhookDeliveryAttemptRepository;
};

/**
 * Wire the notify-domain dependency graph: instantiate repositories, build services with their
 * cross-domain collaborators, configure the in-process notification dispatch singleton, and
 * register notify event handlers. Returns the public {@link NotifyContainer} surface.
 */
export function createNotifyContainer(
  organizationService: OrganizationService,
  userService: UserService,
): NotifyContainer {
  const notificationRepository = new NotificationRepository();
  const webhookRepository = new WebhookRepository();
  const webhookDeliveryAttemptRepository = new WebhookDeliveryAttemptRepository();
  const webhookEventRepository = new WebhookEventRepository();

  const notificationService = new NotificationService(notificationRepository, userService);
  const webhookService = new WebhookService(
    organizationService,
    webhookRepository,
    webhookDeliveryAttemptRepository,
  );
  const webhookEventService = new WebhookEventService(webhookEventRepository);

  configureNotificationDispatch(createNotificationDispatch(notificationRepository));
  registerNotifyEventHandlers();

  return {
    notificationService,
    webhookService,
    webhookEventService,
    webhookDeliveryAttemptRepository,
  };
}

/**
 * Fastify plugin entry point — pulls cross-domain services off `application.tenancyDomain` /
 * `application.userDomain` and decorates the resulting {@link NotifyContainer} as
 * `application.notifyDomain` for routes and other plugins to consume.
 */
export function registerNotifyContainer(application: FastifyInstance): void {
  const { organizationService } = application.tenancyDomain;
  const { userService } = application.userDomain;
  application.decorate('notifyDomain', createNotifyContainer(organizationService, userService));
}
