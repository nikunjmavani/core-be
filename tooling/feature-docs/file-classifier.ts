/**
 * Maps a TypeScript filename to a {@link FileRole} so the renderer can group
 * exports under the right `DOCS.md` H2 (Routes / Controllers / Services / ...).
 *
 * The classification is filename-driven (matching the project's strict
 * `<resource>.<role>.ts` convention) so the generator stays predictable
 * without parsing TypeScript ASTs.
 */
import { POLICY_LIKE_FILE_PATTERN, SERVICE_LIKE_FILE_PATTERN } from './constants.js';
import type { FileRole } from './types.js';

const FILENAME_ROLE_RULES: Array<{ pattern: RegExp; role: FileRole }> = [
  { pattern: /\.routes\.ts$/, role: 'routes' },
  { pattern: /\.controller\.ts$/, role: 'controller' },
  { pattern: /\.service\.ts$/, role: 'service' },
  { pattern: /\.repository\.ts$/, role: 'repository' },
  { pattern: /\.worker\.ts$/, role: 'worker' },
  { pattern: /\.processor\.ts$/, role: 'processor' },
  { pattern: /\.queue\.ts$/, role: 'queue' },
  { pattern: /(\.|-)event(s|-handlers)?\.ts$/, role: 'event' },
  { pattern: /\.schema\.ts$/, role: 'schema' },
  { pattern: /\.dto\.ts$/, role: 'dto' },
  { pattern: /\.validator\.ts$/, role: 'validator' },
  { pattern: /\.serializer\.ts$/, role: 'serializer' },
  { pattern: /\.types\.ts$/, role: 'types' },
  { pattern: /\.container\.ts$/, role: 'container' },
  { pattern: /\.middleware\.ts$/, role: 'middleware' },
  { pattern: /\.context\.ts$/, role: 'context' },
  { pattern: /\.client\.ts$/, role: 'client' },
  { pattern: /\.config\.ts$/, role: 'config' },
  { pattern: /\.constants\.ts$/, role: 'constants' },
  { pattern: /\.error\.ts$/, role: 'error' },
  { pattern: /\.policy\.ts$/, role: 'policy' },
  { pattern: /\.plugin\.ts$/, role: 'plugin' },
  { pattern: /\.seed\.ts$/, role: 'seed' },
  { pattern: /\.util\.ts$/, role: 'util' },
  { pattern: /(^|\/)index\.ts$/, role: 'index' },
];

export function classifyFile(fileName: string): FileRole {
  for (const rule of FILENAME_ROLE_RULES) {
    if (rule.pattern.test(fileName)) return rule.role;
  }
  return 'other';
}

export function isServiceLikeFile(fileName: string): boolean {
  return SERVICE_LIKE_FILE_PATTERN.test(fileName);
}

export function isPolicyLikeFile(fileName: string): boolean {
  return POLICY_LIKE_FILE_PATTERN.test(fileName);
}

export const FILE_ROLE_DISPLAY_LABELS: Record<FileRole, string> = {
  routes: 'Routes',
  controller: 'Controllers',
  service: 'Services',
  repository: 'Repositories',
  worker: 'Workers',
  processor: 'Processors',
  queue: 'Queues',
  event: 'Events',
  schema: 'Schemas',
  dto: 'DTOs',
  validator: 'Validators',
  serializer: 'Serializers',
  types: 'Types',
  container: 'Containers',
  middleware: 'Middlewares',
  util: 'Utilities',
  context: 'Contexts',
  client: 'Clients',
  config: 'Configuration',
  constants: 'Constants',
  error: 'Errors',
  policy: 'Policies',
  plugin: 'Plugins',
  index: 'Index',
  seed: 'Seeds',
  script: 'Scripts',
  test: 'Tests',
  other: 'Other',
};

export const ROLE_RENDER_ORDER: FileRole[] = [
  'routes',
  'controller',
  'service',
  'repository',
  'worker',
  'processor',
  'queue',
  'event',
  'schema',
  'dto',
  'validator',
  'serializer',
  'middleware',
  'context',
  'client',
  'plugin',
  'container',
  'policy',
  'config',
  'constants',
  'error',
  'util',
  'types',
  'seed',
  'script',
  'index',
  'other',
];
