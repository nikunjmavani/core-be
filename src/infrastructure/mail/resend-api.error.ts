/**
 * Resend returned a structured API error (4xx/validation) — counts as a circuit breaker failure.
 */
export class ResendApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResendApiError';
  }
}
