import { describe, expect, it } from 'vitest';
import {
  composeContributions,
  type DomainSeedModule,
  orderModules,
  type SeedContext,
  type SeedContribution,
} from '@/scripts/seed/seed-contract.js';

const fakeContext = {} as SeedContext;

describe('composeContributions', () => {
  it('runs every seedReference then every seedBulk in order, skipping undefined hooks', async () => {
    const calls: string[] = [];
    const first: SeedContribution = {
      seedReference: () => {
        calls.push('first.ref');
        return Promise.resolve();
      },
      seedBulk: () => {
        calls.push('first.bulk');
        return Promise.resolve();
      },
    };
    const second: SeedContribution = {
      seedBulk: () => {
        calls.push('second.bulk');
        return Promise.resolve();
      },
    };

    const composed = composeContributions(first, second);
    await composed.seedReference?.(fakeContext);
    await composed.seedBulk?.(fakeContext);

    expect(calls).toEqual(['first.ref', 'first.bulk', 'second.bulk']);
  });
});

describe('orderModules', () => {
  const moduleNamed = (name: string, dependsOn?: string[]): DomainSeedModule => ({
    name,
    seedBulk: () => Promise.resolve(),
    ...(dependsOn ? { dependsOn } : {}),
  });

  it('orders each dependency before its dependents', () => {
    const billing = moduleNamed('billing', ['tenancy']);
    const tenancy = moduleNamed('tenancy', ['user']);
    const user = moduleNamed('user');

    const ordered = orderModules([billing, tenancy, user]).map((module) => module.name);

    expect(ordered.indexOf('user')).toBeLessThan(ordered.indexOf('tenancy'));
    expect(ordered.indexOf('tenancy')).toBeLessThan(ordered.indexOf('billing'));
  });

  it('throws on an unknown dependency', () => {
    expect(() => orderModules([moduleNamed('a', ['missing'])])).toThrow(/unknown module "missing"/);
  });

  it('throws on a dependency cycle', () => {
    expect(() => orderModules([moduleNamed('a', ['b']), moduleNamed('b', ['a'])])).toThrow(/cycle/);
  });
});
