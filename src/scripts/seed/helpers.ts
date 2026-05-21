/**
 * Shared seed script utilities. Orchestration only — no entity insert logic.
 * Domain seeds live in src/domains/<domain>/.../*.seed.ts
 */
export { closeDatabase } from '@/infrastructure/database/connection.js';
