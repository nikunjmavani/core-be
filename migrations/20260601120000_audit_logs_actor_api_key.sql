-- Migration: audit_logs_actor_api_key
-- Created: 2026-06-01T12:00:00.000Z
-- Reference: docs/reference/data/migrations.md
--
-- Attribute audit rows performed by an organization API key (no acting user) to that key.
--
-- `actor_user_id` stays nullable: it is `ON DELETE SET NULL`, so deleting a user tombstones the
-- actor on their audit rows. A CHECK requiring one of (actor_user_id, actor_api_key_id) is therefore
-- intentionally NOT added — it would make user deletion fail when re-validating those rows. The
-- application guarantees at least one actor is set at write time (see AuditService.record).

ALTER TABLE audit.logs
  ADD COLUMN IF NOT EXISTS actor_api_key_id bigint;
--> statement-breakpoint
ALTER TABLE audit.logs
  ADD CONSTRAINT logs_actor_api_key_id_api_keys_id_fk
  FOREIGN KEY (actor_api_key_id) REFERENCES tenancy.api_keys(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE audit.logs VALIDATE CONSTRAINT logs_actor_api_key_id_api_keys_id_fk;
