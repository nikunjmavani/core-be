import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DOMAINS_ROOT } from './constants.js';

export function collectRouteFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      collectRouteFiles(fullPath, files);
    } else if (entry.endsWith('.routes.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

export function collectPermissionFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      collectPermissionFiles(fullPath, files);
    } else if (entry.endsWith('.permissions.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

export function listDomainRouteFiles(): string[] {
  return collectRouteFiles(DOMAINS_ROOT).filter((file) => file.endsWith('.routes.ts'));
}
