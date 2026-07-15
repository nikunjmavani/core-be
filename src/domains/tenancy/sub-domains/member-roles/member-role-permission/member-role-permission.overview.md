`src/domains/tenancy/sub-domains/member-roles/member-role-permission/`

# Member role permissions (nested resource)

Parent: [member-roles](../member-roles.overview.md)

## Purpose

Manages the set of permission codes assigned to a member role — the role↔permission join. The read path (`listPermissionCodesForRole`) feeds `MembershipService.getPermissions`, which the Redis-cached authorization layer consumes.

## Layout

- `member-role-permission.controller.ts` / `member-role-permission.service.ts` — thin HTTP + application layer
- `member-role-permission.repository.ts` / `member-role-permission.schema.ts` — join-table persistence
- `member-role-permission.dto.ts` / `member-role-permission.validator.ts` / `member-role-permission.serializer.ts` / `member-role-permission.types.ts` — request/response shaping
- `__tests__/unit/` — service/validator/serializer unit suites

No routes file: the parent `member-roles` routes register this resource's endpoints. No seed/workers/events.

## Key invariants

- `PUT` replaces the role's **entire** permission set atomically (DELETE + INSERT in one transaction), then calls `invalidateOrganizationPermissions` — an O(1) bump of the whole org's permission-cache namespace, so stale grants never survive a role edit.
- Guards reject granting non-grantable permission codes and any edit to the owner role.
