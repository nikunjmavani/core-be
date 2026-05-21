# Audit logs

Core-be records security-relevant mutations in `audit.logs` via `recordScopedAuditEvent` (controllers) and `recordAuditEvent` (infrastructure). Writes are **best-effort**: failures are logged and must not fail the HTTP request.

## Query API

- `GET /api/v1/tenancy/organizations/:id/audit-logs` — requires `audit-log:read`, scoped by organization.

## Action naming

Actions use dot-separated names: `<domain>.<resource>.<verb>`.

| Action | Resource type | When |
| ------ | ------------- | ---- |
| `auth.login` | `session` | Successful password login |
| `auth.logout` | `session` | Bearer logout |
| `auth.password.change` | `user` | Authenticated password change |
| `auth.auth_method.create` | `auth_method` | Link auth method |
| `auth.auth_method.delete` | `auth_method` | Remove auth method |
| `auth.mfa.enroll` | `mfa_method` | MFA enrollment |
| `auth.mfa.delete` | `mfa_method` | MFA removal |
| `auth.session.revoke` | `session` | Revoke one session |
| `auth.session.revoke_all` | `session` | Revoke all sessions |
| `tenancy.organization_settings.update` | `organization_settings` | PATCH org settings |
| `tenancy.role.create` | `role` | Create member role |
| `tenancy.role.update` | `role` | Update member role |
| `tenancy.role.delete` | `role` | Delete member role |
| `tenancy.role_permissions.put` | `role` | Replace role permissions |
| `tenancy.membership.create` | `membership` | Add member |
| `tenancy.membership.update` | `membership` | Update membership |
| `tenancy.membership.delete` | `membership` | Remove member |
| `tenancy.membership.leave` | `membership` | Member leaves org |
| `tenancy.membership.transfer_ownership` | `organization` | Ownership transfer |
| `tenancy.member_invitation.create` | `member_invitation` | Send invitation |
| `tenancy.member_invitation.resend` | `member_invitation` | Resend invitation |
| `tenancy.member_invitation.revoke` | `member_invitation` | Revoke invitation |
| `tenancy.api_key.create` | `api_key` | Create API key |
| `tenancy.api_key.update` | `api_key` | Update API key |
| `tenancy.api_key.delete` | `api_key` | Delete API key |
| `tenancy.api_key.rotate` | `api_key` | Rotate API key |
| `billing.subscription.create` | `subscription` | New subscription |
| `billing.subscription.update` | `subscription` | Update subscription |
| `billing.subscription.change_plan` | `subscription` | Plan change |
| `billing.subscription.cancel` | `subscription` | Cancel subscription |
| `billing.subscription.resume` | `subscription` | Resume subscription |
| `notify.webhook.create` | `webhook` | Create outbound webhook |
| `notify.webhook.update` | `webhook` | Update webhook |
| `notify.webhook.delete` | `webhook` | Delete webhook |
| `user.settings.update` | `user_settings` | PATCH user settings |
| `queue.pause` | `queue` | Bull Board queue pause (super admin) |

## Row shape

- `actor_user_id` — resolved from JWT `userId` (public id).
- `organization_id` — set when the mutation is org-scoped (resolved from `X-Organization-Id` path param).
- `metadata` — public ids and non-PII context (no passwords or tokens). The list API runs `sanitizeAuditLogMetadata` so internal numeric `*_id` keys (except `*_public_id`), underscore-prefixed keys, and credential-like fields are stripped from responses.

## Export

Daily NDJSON export to S3 is documented in [audit-export.md](./audit-export.md).

## Tests

- `src/tests/security/mutation-audit.security.test.ts` — login, logout, org settings.
- `src/tests/security/queue-dashboard-audit.security.test.ts` — Bull Board mutations.
