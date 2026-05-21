import { AppError } from './app.error.js';

/**
 * Thrown when application wiring or configuration is incorrect at runtime
 * (e.g. a DI container failed to register a dependency, or a required
 * environment variable is missing when its dependent code path executes).
 *
 * Maps to HTTP 500. The `detail` argument is operator-facing diagnostic
 * context captured in logs and Sentry; clients only see the generic
 * `errors:internal` message via the error handler middleware.
 */
export class ConfigurationError extends AppError {
  constructor(detail: string) {
    super('INTERNAL_ERROR', 500, 'errors:internal', undefined, detail);
  }
}
