export {
  outboundCall,
  buildOutboundCallOptions,
  type OutboundCallOptions,
  type OutboundCallRetryOptions,
} from '@/infrastructure/outbound/outbound-call.js';
export {
  outboundFetch,
  buildOutboundFetchOptions,
  buildOutboundFetchLogContext,
  type OutboundFetchOptions,
  type OutboundFetchImplementation,
} from '@/infrastructure/outbound/outbound-fetch.js';
export {
  ExternalServiceError,
  classifyOutboundError,
  isOutboundRetryable,
  recordOutboundFailureBreadcrumb,
  type OutboundCategory,
} from '@/infrastructure/outbound/outbound-error.js';
export {
  resolveOutboundDefaults,
  type OutboundIntegrationName,
  type OutboundIntegrationDefaults,
} from '@/infrastructure/outbound/outbound-defaults.js';
export {
  redactOutboundBody,
  redactOutboundHeaders,
} from '@/infrastructure/outbound/outbound-redaction.js';
