export type RouteAccess =
  | 'PUBLIC'
  | 'AUTH'
  | `ROLE: ${string}`
  | `PERM: ${string}`
  | `TOKEN: ${string}`;

export type RegistryAccess =
  | 'public'
  | 'authenticated'
  | 'global-role'
  | 'org-permission'
  | 'bearer-token';

/** Active-organization scope: `team` routes reject a personal org with 422; `both` work on either. */
export type RouteOrgScope = 'both' | 'team';

export type ParsedRoute = {
  method: string;
  fullPath: string;
  access: RouteAccess;
  domainKey: string;
  domain: string;
  subDomain?: string;
  subDomainLabel?: string;
  /** Documented happy-path success status (from route-success-statuses.json). */
  successStatus?: number;
  /** True when the route registers `config.idempotencyRequired: true`. */
  idempotencyRequired?: boolean;
  /** Active-organization scope (`team` = 422 on a personal org). Defaults to `both`. */
  orgScope?: RouteOrgScope;
  /** True when the route emits RFC 8594 deprecation headers (`applyDeprecatedEndpointHeaders`). */
  deprecated?: boolean;
};
