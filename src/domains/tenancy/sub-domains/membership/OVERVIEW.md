`src/domains/tenancy/sub-domains/membership/`

# Membership

Parent: [tenancy](../../OVERVIEW.md)

## Purpose

The link between users and organizations: who is in which organization with which role. Includes the nested [member-invitation](src/domains/tenancy/sub-domains/membership/member-invitation/) resource for inviting users (signed-up or not) to an organization.

## Key invariants

- **Unique `(user_id, organization_id)`**: a user has at most one membership per organization (soft-delete + re-add reuses the same logical row).
- **Membership change invalidates the permission cache**: every create / update / soft-delete invalidates the `(user, org)` Redis key before responding.
- **Invitations are one-shot**: atomic accept consumes the row exactly once.
- **Initial activation is invitation-driven only**: accepting an invitation atomically flips the linked membership to `ACTIVE` and stamps `joined_at` in the same transaction as `accepted_at`. A manager `PATCH /memberships/:id` **cannot** set a never-joined (`joined_at IS NULL`) membership to `ACTIVE` — that returns `403 errors:membershipActivationRequiresInvitationAccept`. Reactivating a previously-active member (`SUSPENDED -> ACTIVE`, which already has `joined_at`) stays allowed so admin suspend/reactivate flows keep working. This keeps onboarding consent/audit unambiguous: a membership only becomes active when its invitee accepts.
- **Invitation tokens are hashed at rest**: same construction as magic-link / verification tokens (`sha256(raw)`).

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> invited: invitation created (member-invitation)
  invited --> active: invitation accepted
  invited --> cancelled: admin cancels
  invited --> expired: TTL passes
  active --> active: role change (permission cache invalidated)
  active --> tombstoned: soft delete (member removed)
  tombstoned --> [*]: retention worker purges after window
```

## Events

- Emits: `MEMBER_INVITATION_EVENT.CREATED`, `MEMBER_INVITATION_EVENT.RESENT` (each handler enqueues mail).

## External integrations

- **Resend** (via mail outbox) for invitation emails.

## Failure modes

- **Invitee already a member** → 409 `errors:invitationAlreadyMember`.
- **Disposable email blocked on invite** → 400 `errors:disposableEmail`.
- **Invitation token expired** → 401 `errors:invitationTokenExpired`.
- **Invitation accepted twice** → 409 (atomic accept consumed the row on the first call).
- **Invitation cancelled before accept** → 410 `errors:invitationCancelled`.
