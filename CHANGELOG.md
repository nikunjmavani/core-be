# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-05-16

### BREAKING CHANGES

- **Row-level security (RLS)** organization isolation is enforced at the database layer (`enable_rls`, `notifications_rls` migrations). HTTP requests must flow through tenant middleware so Postgres session variable `app.current_organization_id` is set; **workers and scripts must pass organization identifiers explicitly in queries** — do not rely on RLS session context outside HTTP (see `CLAUDE.md`).

### Security

- **RLS**: Policies enabled across tenancy, auth, billing, notify, audit, and related schemas so row access is scoped by organization where applicable.
- **Notifications RLS**: Notify schema tables participate in organization-scoped RLS.

### Added

- **API keys**: Persistence and domain support for organization API keys (`create_api_keys` migration).
- **Billing domain**: Plans, subscriptions, Stripe customer linkage, and Stripe webhook handling (`add_stripe_customer_id` migration and `src/domains/billing/`).
- **Notify domain**: Notifications and outbound webhooks (`src/domains/notify/`).
- **Audit domain**: Audit logging and retention worker (`src/domains/audit/`, including `audit-retention.worker.ts`).
- **Upload domain**: File upload flows (`src/domains/upload/`).
- **Verification tokens**: Schema support for verification-token flows (`create_verification_tokens` migration).

### Changed

- **Permissions**: Reference permission seed migration aligns baseline roles and permissions (`seed_permissions` migration).
- **Webhooks**: Organization-scoped uniqueness for webhook URLs (`webhooks_org_url_unique` migration).
- **Webhooks**: Soft-delete support for webhooks (`webhooks_soft_delete` migration).
- **Organization notification policies**: Soft-delete support (`organization_notification_policies_soft_delete` migration).

## [1.0.0] - 2025-02-18

### Security

- **SSRF protection**: Webhook URLs validated against private IP ranges; blocks localhost, link-local, and internal networks
- **OAuth CSRF protection**: State parameter stored in Redis with 10-min TTL; validated and consumed on callback
- **OAuth timeouts**: All OAuth provider fetch calls use 10s timeout
- **Webhook response truncation**: Test webhook response body truncated to 500 chars to prevent sensitive data leakage
- **Production JWT**: RS256 required in production (JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set)
- **Logger redaction**: Added api_key, access_key_id, secret_access_key to Pino redaction paths
- **Seed password**: Demo password from TEST_PASSWORD env or randomly generated (no hardcoded fallback)

### Fixed

- **Worker shutdown**: RSS monitoring interval cleared on worker shutdown to prevent memory leak

### Added

- **File magic bytes**: Utility for validating upload content-type via magic bytes (PNG, JPEG, WebP, PDF)
