import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPostgresOptions,
  closeDatabase,
  isNeonPoolerConnection,
  sql,
} from '@/infrastructure/database/connection.js';
import { getShutdownTimeoutMs } from '@/infrastructure/queue/worker-runtime/shutdown-timing.util.js';
import { env } from '@/shared/config/env.config.js';

describe('postgres connection options', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isNeonPoolerConnection', () => {
    it('detects Neon pooler hostnames', () => {
      expect(
        isNeonPoolerConnection(
          'postgresql://user:pass@ep-cool-name-pooler.us-east-2.aws.neon.tech/neondb',
        ),
      ).toBe(true);
    });

    it('detects pgbouncer query parameter', () => {
      expect(
        isNeonPoolerConnection('postgresql://user:pass@localhost:5432/app?pgbouncer=true'),
      ).toBe(true);
    });

    it('returns false for direct non-pooler URLs', () => {
      expect(isNeonPoolerConnection('postgresql://user:pass@localhost:5432/app')).toBe(false);
    });
  });

  describe('buildPostgresOptions', () => {
    it('disables prepared statements for pooler URLs (Neon transaction pooling)', () => {
      const options = buildPostgresOptions(
        'postgresql://user:pass@ep-example-pooler.aws.neon.tech/neondb?sslmode=require',
      );
      expect(options.prepare).toBe(false);
    });

    it('does not set prepare for direct database URLs', () => {
      const options = buildPostgresOptions('postgresql://user:pass@localhost:5432/core');
      expect(options).not.toHaveProperty('prepare');
    });

    it('applies prepare:false to any pooler hostname with pgbouncer enabled', () => {
      const options = buildPostgresOptions(
        'postgresql://user:pass@reporting-pooler.aws.neon.tech/neondb?pgbouncer=true',
      );
      expect(options.prepare).toBe(false);
    });

    it('resolves the pool max from DATABASE_POOL_MAX (defaults to 20 in the env schema)', () => {
      const options = buildPostgresOptions('postgresql://user:pass@localhost:5432/core');
      // DATABASE_POOL_MAX has an explicit schema default of 20; the env is always a number.
      expect(options.max).toBe(env.DATABASE_POOL_MAX);
    });
  });

  describe('closeDatabase (EX-32)', () => {
    it('drains using the shared shutdown timeout so it can never exceed the watchdog budget', async () => {
      // EX-32: closeDatabase must use getShutdownTimeoutMs() (the same drain budget the watchdog is
      // derived from), not its own longer default — otherwise the force-exit watchdog could kill the
      // postgres pool drain mid-flight.
      const endSpy = vi.spyOn(sql, 'end').mockResolvedValue(undefined);
      try {
        await closeDatabase();
        expect(endSpy).toHaveBeenCalledWith({ timeout: getShutdownTimeoutMs() });
      } finally {
        endSpy.mockRestore();
      }
    });
  });
});
