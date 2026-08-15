/**
 * Policy: every domain event constant is REAL — emitted somewhere and handled
 * somewhere. No ghost events, no orphan handlers.
 *
 * History: `BILLING_EVENT` was documented for months while having ZERO code —
 * never defined, emitted, or consumed (fixed in PR #892 by marking the docs
 * "planned"). The inverse drift is just as easy: a service stops emitting an
 * event while its handler (and the docs describing the side effect) stay
 * behind, or a new event key ships with an emitter but nobody subscribes, so
 * the side effect silently never happens.
 *
 * For every key of every `*_EVENT` map under `src/domains/**\/events/*.events.ts`:
 * - ≥ 1 EMITTER: `CONST.KEY` referenced in a non-test file that calls
 *   `eventBus.emit(` (covers both `buildDomainEvent(CONST.KEY, …)` and
 *   `{ type: CONST.KEY, … }` shapes).
 * - ≥ 1 HANDLER: an `eventBus.on(CONST.KEY, …)` registration.
 * - Event string values are globally unique across all maps.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const SOURCE_ROOT = join(PROJECT_ROOT, 'src');

interface EventKey {
  constantName: string;
  key: string;
  value: string;
  definingFile: string;
}

function collectSourceFiles(directory: string, accumulator: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      collectSourceFiles(fullPath, accumulator);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
    accumulator.push(relative(PROJECT_ROOT, fullPath));
  }
  return accumulator;
}

function parseEventMaps(files: readonly string[]): EventKey[] {
  const eventKeys: EventKey[] = [];
  for (const filePath of files) {
    if (!/\/events\/[^/]+\.events\.ts$/.test(filePath)) continue;
    const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
    const mapPattern = /export const ([A-Z][A-Z0-9_]*_EVENT)\s*=\s*\{([\s\S]*?)\}\s*(?:as const)?/g;
    for (const mapMatch of source.matchAll(mapPattern)) {
      const [, constantName, body] = mapMatch;
      if (constantName === undefined || body === undefined) continue;
      const keyPattern = /([A-Z][A-Z0-9_]*)\s*:\s*'([a-z0-9_.]+)'/g;
      for (const keyMatch of body.matchAll(keyPattern)) {
        const [, key, value] = keyMatch;
        if (key === undefined || value === undefined) continue;
        eventKeys.push({ constantName, key, value, definingFile: filePath });
      }
    }
  }
  return eventKeys;
}

describe('Global: event wiring parity', () => {
  const sourceFiles = collectSourceFiles(SOURCE_ROOT);
  const sources = new Map(
    sourceFiles.map((filePath) => [filePath, readFileSync(join(PROJECT_ROOT, filePath), 'utf8')]),
  );
  const eventKeys = parseEventMaps(sourceFiles);

  it('finds event maps to verify', () => {
    // AUTH_EVENT (2) + MEMBER_INVITATION_EVENT (3) + NOTIFY_EVENT (1) today.
    expect(eventKeys.length).toBeGreaterThanOrEqual(6);
  });

  it('every event key has at least one emitter (referenced in a file that calls eventBus.emit)', () => {
    const missingEmitters: string[] = [];
    for (const { constantName, key, definingFile } of eventKeys) {
      const reference = new RegExp(String.raw`\b${constantName}\.${key}\b`);
      // Covers every bus emit variant (`eventBus.emit(`, `eventBus.emitStrict(`).
      const emitCall = /eventBus\.emit\w*\(/;
      const hasEmitter = [...sources.entries()].some(
        ([filePath, source]) =>
          filePath !== definingFile && emitCall.test(source) && reference.test(source),
      );
      if (!hasEmitter) missingEmitters.push(`${constantName}.${key} (${definingFile})`);
    }
    expect(
      missingEmitters,
      'Event key defined but never emitted — remove the ghost key or wire the emitter.',
    ).toEqual([]);
  });

  it('every event key has at least one registered handler (eventBus.on)', () => {
    const missingHandlers: string[] = [];
    for (const { constantName, key, definingFile } of eventKeys) {
      const registration = new RegExp(String.raw`eventBus\.on\(\s*${constantName}\.${key}\b`);
      const hasHandler = [...sources.values()].some((source) => registration.test(source));
      if (!hasHandler) missingHandlers.push(`${constantName}.${key} (${definingFile})`);
    }
    expect(
      missingHandlers,
      'Event key emitted (or defined) with no eventBus.on handler — the side effect ' +
        'silently never runs. Register a handler or remove the event.',
    ).toEqual([]);
  });

  it('event string values are globally unique across all event maps', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const { constantName, key, value } of eventKeys) {
      const existing = seen.get(value);
      if (existing !== undefined) {
        collisions.push(`'${value}' defined by both ${existing} and ${constantName}.${key}`);
      } else {
        seen.set(value, `${constantName}.${key}`);
      }
    }
    expect(collisions).toEqual([]);
  });
});
