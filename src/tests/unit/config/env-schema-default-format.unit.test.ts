import { describe, expect, it } from 'vitest';
import { formatEnvSchemaDefault } from '@/shared/config/env-schema.js';

// formatEnvSchemaDefault turns a parsed Zod default into the exact string persisted in
// .env.example. The key invariant is that it never emits "[object Object]" (Sonar S6551) while
// keeping the historical String()/comma-join shape that github:sync exact-matches against.
describe('formatEnvSchemaDefault', () => {
  it('returns strings unchanged', () => {
    expect(formatEnvSchemaDefault('redis://localhost:6379')).toBe('redis://localhost:6379');
    expect(formatEnvSchemaDefault('')).toBe('');
  });

  it('stringifies numeric, boolean, and bigint scalars', () => {
    expect(formatEnvSchemaDefault(3000)).toBe('3000');
    expect(formatEnvSchemaDefault(0)).toBe('0');
    expect(formatEnvSchemaDefault(true)).toBe('true');
    expect(formatEnvSchemaDefault(false)).toBe('false');
    expect(formatEnvSchemaDefault(10n)).toBe('10');
  });

  it('keeps the historical array shape: empty → "", otherwise comma-joined', () => {
    expect(formatEnvSchemaDefault([])).toBe('');
    expect(formatEnvSchemaDefault(['a', 'b', 'c'])).toBe('a,b,c');
    expect(formatEnvSchemaDefault([1, 2])).toBe('1,2');
  });

  it('JSON-serializes objects instead of emitting "[object Object]"', () => {
    expect(formatEnvSchemaDefault({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
    expect(formatEnvSchemaDefault({})).toBe('{}');
    // the whole reason this helper exists — never the String(object) footgun
    expect(formatEnvSchemaDefault({ a: 1 })).not.toBe('[object Object]');
  });

  it('returns undefined for values with no representable default (caller omits the key)', () => {
    expect(formatEnvSchemaDefault(null)).toBeUndefined();
    expect(formatEnvSchemaDefault(undefined)).toBeUndefined();
    expect(formatEnvSchemaDefault(Symbol('x'))).toBeUndefined();
  });
});
