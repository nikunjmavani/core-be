`src/domains/user/sub-domains/user-notification-preferences/`

# User notification preferences

Parent: [user](../../OVERVIEW.md)

## Purpose

Per-user opt-in / opt-out for the notification + email channels. The platform respects these preferences at fan-out time — a notification handler that would have produced a row for a user who has opted out of the channel is a no-op.

## Key invariants

- **Default-on for transactional channels**: security-relevant notifications (login alerts, MFA enrolment, password change) ignore the preference and always deliver. Marketing / promotional channels are opt-out and respect the preference.
- **One row per user**: missing row implies platform defaults (which are channel-aware as above).
- **Granularity is per-channel × per-event-class**: the schema lets a user opt out of "billing notifications via email" but keep "billing notifications in-app".

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> default: user has no row → platform defaults apply
  default --> customized: PATCH /users/me/notification-preferences
  customized --> customized: subsequent PATCH
  customized --> default: explicit reset
```

## Failure modes

- **Attempt to opt out of a transactional channel** → 400; UI should hide the toggle for those channels.
- **Unknown channel or event-class key** → 400.
