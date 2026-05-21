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

export type NotifyContainer = {
  notificationService: NotificationService;
  webhookService: WebhookService;
  webhookEventService: WebhookEventService;
  webhookDeliveryAttemptRepository: WebhookDeliveryAttemptRepository;
};

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

export function registerNotifyContainer(application: FastifyInstance): void {
  const { organizationService } = application.tenancyDomain;
  const { userService } = application.userDomain;
  application.decorate('notifyDomain', createNotifyContainer(organizationService, userService));
}
