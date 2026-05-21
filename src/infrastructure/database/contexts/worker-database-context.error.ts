/**
 * Thrown when a worker process accesses Postgres without a pinned worker database context
 * (organization, retention, user, session cleanup, or system-table bypass).
 */
export class WorkerDatabaseContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerDatabaseContextError';
  }
}
