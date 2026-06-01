import { describe, expect, it } from 'vitest';
import { SEED_MODULES } from '@/scripts/seed/modules.js';
import { orderModules } from '@/scripts/seed/seed-contract.js';

/**
 * Smoke test for the bulk-seed orchestration wiring. DB-level row seeding + idempotency is
 * exercised by running `pnpm db:seed:bulk`; here we guard the static assembly so a domain can't
 * be dropped from the registry or wired with a broken/cyclic dependency without failing CI.
 */
describe('SEED_MODULES registry', () => {
  it('registers every domain with a unique name', () => {
    const names = SEED_MODULES.map((module) => module.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining(['user', 'auth', 'tenancy', 'billing', 'notify', 'upload', 'audit']),
    );
  });

  it('every dependsOn references a registered module', () => {
    const names = new Set(SEED_MODULES.map((module) => module.name));
    for (const module of SEED_MODULES) {
      for (const dependency of module.dependsOn ?? []) {
        expect(names.has(dependency)).toBe(true);
      }
    }
  });

  it('orders without cycles, dependencies before dependents', () => {
    const ordered = orderModules(SEED_MODULES).map((module) => module.name);
    expect(ordered.indexOf('user')).toBeLessThan(ordered.indexOf('tenancy'));
    expect(ordered.indexOf('tenancy')).toBeLessThan(ordered.indexOf('billing'));
    expect(ordered.indexOf('user')).toBeLessThan(ordered.indexOf('auth'));
  });

  it('every module exposes a seedBulk function', () => {
    for (const module of SEED_MODULES) {
      expect(typeof module.seedBulk).toBe('function');
    }
  });
});
