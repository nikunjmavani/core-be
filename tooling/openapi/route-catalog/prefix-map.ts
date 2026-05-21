import { readFileSync } from 'node:fs';
import { collectPermissionFiles } from './file-collectors.js';
import { DOMAINS_ROOT } from './constants.js';

export function loadDomainPrefixMap(routesTsContent: string): Map<string, string> {
  const pluginToFolder = new Map<string, string>();
  const importPattern = /import\s*\{\s*(\w+)\s*\}\s*from\s*'@\/domains\/([\w-]+)\//g;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importPattern.exec(routesTsContent)) !== null) {
    const pluginVariable = importMatch[1];
    const domainFolder = importMatch[2];
    if (pluginVariable && domainFolder) {
      pluginToFolder.set(pluginVariable, domainFolder);
    }
  }

  const prefixByDomainFolder = new Map<string, string>();
  const registerPattern = /app\.register\((\w+),\s*\{\s*prefix:\s*`\$\{apiV1\}\/([^`]+)`/g;
  let registerMatch: RegExpExecArray | null;
  while ((registerMatch = registerPattern.exec(routesTsContent)) !== null) {
    const pluginVariable = registerMatch[1];
    const apiSegment = registerMatch[2];
    if (!(pluginVariable && apiSegment)) continue;
    const domainFolder = pluginToFolder.get(pluginVariable);
    if (domainFolder) {
      prefixByDomainFolder.set(domainFolder, `/api/v1/${apiSegment}`);
    }
  }

  return prefixByDomainFolder;
}

export function loadPermissionConstantMap(): Map<string, string> {
  const map = new Map<string, string>();
  const permissionFiles = collectPermissionFiles(DOMAINS_ROOT);

  for (const filePath of permissionFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const objectMatch = content.match(/export const \w+ = \{([\s\S]*?)\} as const/);
    if (!objectMatch) continue;
    const objectName = content.match(/export const (\w+) = \{/)?.[1];
    if (!objectName) continue;

    const objectBody = objectMatch[1];
    if (!objectBody) continue;
    const entries = objectBody.matchAll(/(\w+):\s*['"]([^'"]+)['"]/g);
    for (const entry of entries) {
      const key = entry[1];
      const value = entry[2];
      if (key && value) {
        map.set(`${objectName}.${key}`, value);
      }
    }
  }

  return map;
}
