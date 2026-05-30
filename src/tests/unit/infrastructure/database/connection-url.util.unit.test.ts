import { describe, expect, it } from 'vitest';
import {
  isNeonPoolerConnection,
  isStrictDatabaseTlsVerification,
  parseSslMode,
} from '@/infrastructure/database/connection-url.util.js';

describe('connection-url.util', () => {
  describe('parseSslMode', () => {
    it('extracts and lowercases the sslmode parameter', () => {
      expect(parseSslMode('postgresql://u:p@host/db?sslmode=VERIFY-FULL')).toBe('verify-full');
    });

    it('returns null when sslmode is absent', () => {
      expect(parseSslMode('postgresql://u:p@host/db')).toBeNull();
    });
  });

  describe('isNeonPoolerConnection', () => {
    it('detects -pooler hostnames and pgbouncer=true', () => {
      expect(
        isNeonPoolerConnection('postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db'),
      ).toBe(true);
      expect(isNeonPoolerConnection('postgresql://u:p@host/db?pgbouncer=true')).toBe(true);
    });

    it('returns false for a direct host', () => {
      expect(isNeonPoolerConnection('postgresql://u:p@host:5432/db?sslmode=verify-full')).toBe(
        false,
      );
    });
  });

  describe('isStrictDatabaseTlsVerification', () => {
    it('is strict for verify-ca and verify-full', () => {
      expect(
        isStrictDatabaseTlsVerification({ databaseUrl: 'postgresql://h/db?sslmode=verify-ca' }),
      ).toBe(true);
      expect(
        isStrictDatabaseTlsVerification({ databaseUrl: 'postgresql://h/db?sslmode=verify-full' }),
      ).toBe(true);
    });

    it('is NOT strict for sslmode=require (encrypted but unverified)', () => {
      expect(
        isStrictDatabaseTlsVerification({ databaseUrl: 'postgresql://h/db?sslmode=require' }),
      ).toBe(false);
    });

    it('is strict when DATABASE_SSL_REJECT_UNAUTHORIZED override is true', () => {
      expect(
        isStrictDatabaseTlsVerification({
          databaseUrl: 'postgresql://h/db?sslmode=require',
          rejectUnauthorizedOverride: true,
        }),
      ).toBe(true);
    });

    it('is NOT strict with no sslmode and no override', () => {
      expect(isStrictDatabaseTlsVerification({ databaseUrl: 'postgresql://h/db' })).toBe(false);
    });
  });
});
