import type { RouteAccess } from './types.js';

export function extractRouteSnippet(content: string, methodIndex: number): string {
  const rest = content.slice(methodIndex);
  const nextRouteMatch = rest
    .slice(1)
    .match(/\n\s*(?:app|zodApplication)\.(get|post|patch|put|delete)\s*[(<]/);
  const endIndex =
    nextRouteMatch?.index !== undefined ? nextRouteMatch.index + 1 : Math.min(rest.length, 500);
  return rest.slice(0, endIndex);
}

export function classifyAccess(snippet: string, permissionMap: Map<string, string>): RouteAccess {
  if (!snippet.includes('app.authenticate')) {
    return 'PUBLIC';
  }

  if (snippet.includes('requireRole')) {
    const roles: string[] = [];
    if (snippet.includes('GLOBAL_ROLES.SUPER_ADMIN') || snippet.includes("'super_admin'")) {
      roles.push('super_admin');
    }
    if (snippet.includes('GLOBAL_ROLES.ADMIN') || snippet.includes("'admin'")) {
      roles.push('admin');
    }
    if (snippet.includes('GLOBAL_ROLES.USER') || snippet.includes("'user'")) {
      roles.push('user');
    }
    const uniqueRoles = [...new Set(roles)];
    return `ROLE: ${uniqueRoles.join(', ')}`;
  }

  const permissionMatch = snippet.match(/requireOrganizationPermission\(\s*([\w.]+\.[\w]+)/);
  if (permissionMatch?.[1]) {
    const code = permissionMap.get(permissionMatch[1]) ?? permissionMatch[1];
    return `PERM: ${code}`;
  }

  return 'AUTH';
}
