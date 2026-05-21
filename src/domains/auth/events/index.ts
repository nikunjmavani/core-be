export { registerAuthEventHandlers } from './auth.event-handlers.js';
export {
  AUTH_EVENT,
  type AuthEventType,
  type EmailVerificationEmailPayload,
  type MagicLinkEmailPayload,
  type PasswordResetEmailPayload,
} from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';
