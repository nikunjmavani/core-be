import { AppError } from './app.error.js';

/** One field-level entry in a {@link ValidationError}'s `errors` array (Paddle-style validation output). */
export interface ValidationErrorItem {
  field: string;
  /** Fallback when messageKey is absent or request.t is unavailable. */
  message?: string;
  /** When set, error handler uses request.t(messageKey, messageParams) for message. */
  messageKey?: string;
  messageParams?: Record<string, string | number>;
}

/**
 * 400 Bad Request — request body or params failed schema/business validation.
 * Carries a Paddle-style `errors[]` list with per-field translation keys so
 * the error handler can localize each entry.
 */
export class ValidationError extends AppError {
  readonly details?: Record<string, unknown>;
  /** Paddle-style list for error response */
  readonly errors?: ValidationErrorItem[];

  constructor(
    messageKey: string,
    messageParams?: Record<string, string | number>,
    fallbackMessageOrDetails?: string | Record<string, unknown>,
    errors?: ValidationErrorItem[],
  ) {
    const fallbackMessage =
      typeof fallbackMessageOrDetails === 'string' ? fallbackMessageOrDetails : messageKey;
    const details =
      typeof fallbackMessageOrDetails === 'object' && fallbackMessageOrDetails
        ? fallbackMessageOrDetails
        : undefined;
    super('VALIDATION_ERROR', 400, messageKey, messageParams, fallbackMessage);
    if (details !== undefined) {
      this.details = details;
    }
    const resolvedErrors = errors ?? (details ? objectToFieldMessages(details) : undefined);
    if (resolvedErrors !== undefined) {
      this.errors = resolvedErrors;
    }
  }
}

function objectToFieldMessages(details: Record<string, unknown>): ValidationErrorItem[] {
  return Object.entries(details).map(([field, value]) => ({
    field,
    message: Array.isArray(value)
      ? value.join(', ')
      : typeof value === 'string'
        ? value
        : 'Invalid',
  }));
}
