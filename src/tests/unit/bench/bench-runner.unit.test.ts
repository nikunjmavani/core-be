import { describe, expect, it } from 'vitest';
import {
  BENCH_ENDPOINTS,
  formatBenchTable,
  parseBenchCliOptions,
  summarizeAutocannonRun,
} from '@/tests/bench/run-benches.js';

describe('bench runner helpers', () => {
  it('maps an autocannon JSON summary onto a table row (p95 falls back through p97_5)', () => {
    const row = summarizeAutocannonRun('readyz', {
      latency: { p50: 3, p97_5: 9, p99: 14 },
      requests: { average: 4321.5 },
      '2xx': 43215,
      non2xx: 0,
    });
    expect(row).toEqual({
      name: 'readyz',
      p50: 3,
      p95: 9,
      p99: 14,
      requestsPerSecond: 4321.5,
      ok2xx: 43215,
      non2xx: 0,
    });
  });

  it('prefers a real p95 key when autocannon provides one', () => {
    const row = summarizeAutocannonRun('x', { latency: { p95: 7, p97_5: 11 } });
    expect(row.p95).toBe(7);
  });

  it('treats a missing summary as zeros (endpoint counted broken by the gate)', () => {
    const row = summarizeAutocannonRun('broken', {});
    expect(row.ok2xx).toBe(0);
    expect(row.p99).toBe(0);
  });

  it('parses CLI flags with defaults (10 connections × 10s, table output)', () => {
    expect(parseBenchCliOptions([])).toEqual({ duration: 10, connections: 10, json: false });
    expect(
      parseBenchCliOptions([
        '--duration',
        '30',
        '--connections',
        '4',
        '--only',
        'readyz',
        '--json',
      ]),
    ).toEqual({ duration: 30, connections: 4, only: 'readyz', json: true });
  });

  it('renders a table with one aligned row per result, marking skips', () => {
    const table = formatBenchTable([
      {
        name: 'readyz',
        p50: 3,
        p95: 9,
        p99: 14,
        requestsPerSecond: 4321.5,
        ok2xx: 43215,
        non2xx: 0,
      },
      {
        name: 'users-me',
        p50: 0,
        p95: 0,
        p99: 0,
        requestsPerSecond: 0,
        ok2xx: 0,
        non2xx: 0,
        skipped: 'login failed',
      },
    ]);
    expect(table).toContain('endpoint');
    expect(table).toContain('readyz');
    expect(table).toContain('4321.5');
    expect(table).toContain('— skipped: login failed');
  });

  it('benches the documented hottest paths (matrix drift check)', () => {
    expect(BENCH_ENDPOINTS.map((endpoint) => endpoint.name)).toEqual([
      'readyz',
      'plans-public',
      'users-me',
      'memberships-permission-cached',
    ]);
    // Auth split must stay explicit — an authed endpoint silently benched without
    // its Bearer token measures 401s, not the route.
    expect(
      BENCH_ENDPOINTS.filter((endpoint) => endpoint.requiresAuth).map((endpoint) => endpoint.name),
    ).toEqual(['users-me', 'memberships-permission-cached']);
  });
});
