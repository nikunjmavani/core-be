-- Migration: audit_logs_actor_api_key
-- Created: 2026-06-01T12:00:00.000Z
-- Reference: docs/reference/data/migrations.md
-- migration-safety: allow add_foreign_key_without_not_valid reason="audit.logs is RANGE-partitioned on hosted environments and Postgres rejects ADD FOREIGN KEY ... NOT VALID on partitioned tables (ERROR 42809, cannot add NOT VALID foreign key on partitioned table). actor_api_key_id is a brand-new, all-NULL column so the inline validation scan matches no rows; the constraint is created already-validated with only a momentary lock."
--
-- Attribute audit rows performed by an organization API key (no acting user) to that key.
--
-- `actor_user_id` stays nullable: it is `ON DELETE SET NULL`, so deleting a user tombstones the
-- actor on their audit rows. A CHECK requiring one of (actor_user_id, actor_api_key_id) is therefore
-- intentionally NOT added — it would make user deletion fail when re-validating those rows. The
-- application guarantees at least one actor is set at write time (see AuditService.record).
--
-- The FK is added already-validated (not the deferred-validation form) because audit.logs is
-- RANGE-partitioned on hosted environments, which Postgres forbids for the deferred form. The column
-- is new and all-NULL, so validation scans nothing and the lock is momentary.

ALTER TABLE audit.logs
  ADD COLUMN IF NOT EXISTS actor_api_key_id bigint;
--> statement-breakpoint
ALTER TABLE audit.logs
  ADD CONSTRAINT logs_actor_api_key_id_api_keys_id_fk
  FOREIGN KEY (actor_api_key_id) REFERENCES tenancy.api_keys(id) ON DELETE SET NULL;
