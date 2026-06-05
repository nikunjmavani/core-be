import { describe, expect, it } from 'vitest';
import { HARD_CAP, PROFILES, resolveCounts } from '@/scripts/seed/bulk-config.js';

describe('resolveCounts', () => {
  it('defaults to the demo profile', () => {
    const { profile, counts } = resolveCounts({});
    expect(profile).toBe('demo');
    expect(counts.organizations).toBe(PROFILES.demo.organizations);
  });

  it('selects the load profile', () => {
    const { profile, counts } = resolveCounts({ BULK_PROFILE: 'load' });
    expect(profile).toBe('load');
    expect(counts.organizations).toBe(PROFILES.load.organizations);
  });

  it('applies SCALE to organizations and audit rows', () => {
    const { scale, counts } = resolveCounts({ BULK_PROFILE: 'demo', SCALE: '3' });
    expect(scale).toBe(3);
    expect(counts.organizations).toBe(PROFILES.demo.organizations * 3);
    expect(counts.auditPerOrgPerMonth).toBe(PROFILES.demo.auditPerOrgPerMonth * 3);
  });

  it('honours per-knob overrides', () => {
    const { counts } = resolveCounts({ BULK_ORGS: '7', BULK_USERS_PER_ORG: '4' });
    expect(counts.organizations).toBe(7);
    expect(counts.usersPerOrg).toEqual({ min: 4, max: 4 });
  });

  it('throws on an unknown profile', () => {
    expect(() => resolveCounts({ BULK_PROFILE: 'nope' })).toThrow(/Unknown BULK_PROFILE/);
  });

  it('throws when organizations exceed the hard cap', () => {
    expect(() => resolveCounts({ BULK_ORGS: String(HARD_CAP.organizations + 1) })).toThrow(/cap/);
  });
});
