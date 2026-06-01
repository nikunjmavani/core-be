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

export type ParsedRoute = {
  method: string;
  fullPath: string;
  access: RouteAccess;
  domainKey: string;
  domain: string;
  subDomain?: string;
  subDomainLabel?: string;
};
