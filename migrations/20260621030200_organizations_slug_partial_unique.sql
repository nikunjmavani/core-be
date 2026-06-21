-- migration-transaction: none reason="DROP/CREATE INDEX CONCURRENTLY cannot run inside a transaction"
--
-- audit-R9: make the team-slug unique index PARTIAL on `deleted_at IS NULL`.
--
-- `tenancy.organizations` is a soft-delete table, but `idx_organizations_slug` was a FULL unique
-- index, so a soft-deleted team's slug stayed indexed. `OrganizationRepository.softDelete` only
-- stamps `deleted_at` (it never clears/renames `slug`), and `findBySlug` filters `deleted_at IS NULL`
-- — so after a team is deleted the create pre-check reports the slug free while the INSERT collides
-- with the tombstone, raising unique_violation → 409 "slug already exists" for a slug no visible
-- organization owns. The slug stayed burned until org-tombstone-retention hard-deleted the row days
-- later. Every other natural-key soft-delete table already uses a partial index
-- (idx_users_email_unique, idx_roles_org_name_unique, idx_memberships_user_org_unique); slug was the
-- lone outlier. This realigns it.
--
-- Live slugs are already globally unique (a subset of the old full constraint), so re-creating the
-- index as partial cannot fail on existing data — no backfill/dedup needed. Both statements are
-- CONCURRENTLY + IF EXISTS / IF NOT EXISTS so the migration is online and idempotent. The brief
-- window between DROP and CREATE where two LIVE teams could momentarily share a slug is bounded by
-- the application pre-check (`findBySlug`) and the `chk_organizations_slug` format check; slug
-- creation is rare and the table is small.

DROP INDEX CONCURRENTLY IF EXISTS tenancy.idx_organizations_slug;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_slug
ON tenancy.organizations (slug)
WHERE deleted_at IS NULL;
