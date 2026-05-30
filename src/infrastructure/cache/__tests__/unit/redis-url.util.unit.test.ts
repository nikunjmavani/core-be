import { describe, expect, it } from 'vitest';
import {
  buildRedisTlsOptions,
  deriveBullMqRedisUrlFromCacheUrl,
  isPrivateOrInternalRedisHost,
  isRedisTlsUrl,
  parseRedisUrl,
  usesSeparateBullMqRedisEndpoint,
  usesSeparateBullMqRedisHost,
  validateProductionRedisTopology,
} from '@/infrastructure/cache/redis-url.parse.util.js';

describe('redis-url.parse.util', () => {
  it('deriveBullMqRedisUrlFromCacheUrl returns the cache Redis URL', () => {
    expect(deriveBullMqRedisUrlFromCacheUrl('redis://localhost:6379/0')).toBe(
      'redis://localhost:6379/0',
    );
  });

  it('deriveBullMqRedisUrlFromCacheUrl preserves password', () => {
    expect(deriveBullMqRedisUrlFromCacheUrl('redis://:secret@localhost:6379/0')).toBe(
      'redis://:secret@localhost:6379/0',
    );
  });

  it('parseRedisUrl reads database index from path', () => {
    expect(parseRedisUrl('redis://localhost:6379/2')).toEqual({
      host: 'localhost',
      port: 6379,
      password: undefined,
      databaseIndex: 2,
    });
  });

  it('isRedisTlsUrl detects rediss scheme', () => {
    expect(isRedisTlsUrl('rediss://localhost:6379/0')).toBe(true);
    expect(isRedisTlsUrl('redis://localhost:6379/0')).toBe(false);
  });

  it('usesSeparateBullMqRedisHost is false for same host different logical DB', () => {
    expect(
      usesSeparateBullMqRedisHost('redis://localhost:6379/0', 'redis://localhost:6379/1'),
    ).toBe(false);
  });

  it('usesSeparateBullMqRedisHost is true for different hosts', () => {
    expect(
      usesSeparateBullMqRedisHost(
        'redis://cache.example.railway.internal:6379/0',
        'redis://bullmq.example.railway.internal:6379/0',
      ),
    ).toBe(true);
  });

  it('usesSeparateBullMqRedisEndpoint is true for same host different logical DB', () => {
    expect(
      usesSeparateBullMqRedisEndpoint('redis://localhost:6379/0', 'redis://localhost:6379/1'),
    ).toBe(true);
  });

  it('isPrivateOrInternalRedisHost recognizes trusted private/internal hosts', () => {
    expect(isPrivateOrInternalRedisHost('localhost')).toBe(true);
    expect(isPrivateOrInternalRedisHost('core-redis.railway.internal')).toBe(true);
    expect(isPrivateOrInternalRedisHost('redis.svc.cluster.local')).toBe(true);
    expect(isPrivateOrInternalRedisHost('10.1.2.3')).toBe(true);
    expect(isPrivateOrInternalRedisHost('192.168.0.5')).toBe(true);
    expect(isPrivateOrInternalRedisHost('172.16.4.4')).toBe(true);
  });

  it('isPrivateOrInternalRedisHost rejects public hosts', () => {
    expect(isPrivateOrInternalRedisHost('cache.example.com')).toBe(false);
    expect(isPrivateOrInternalRedisHost('8.8.8.8')).toBe(false);
    expect(isPrivateOrInternalRedisHost('172.32.0.1')).toBe(false);
  });

  it('buildRedisTlsOptions enables strict TLS for rediss:// only', () => {
    expect(buildRedisTlsOptions('rediss://cache.example.com:6379')).toEqual({
      tls: { rejectUnauthorized: true },
    });
    expect(buildRedisTlsOptions('redis://localhost:6379')).toEqual({});
  });

  it('validateProductionRedisTopology allows a dedicated BullMQ endpoint and a shared one', () => {
    // Unset override -> BullMQ shares REDIS_URL (single-instance local dev).
    expect(validateProductionRedisTopology('redis://cache.example/0', undefined)).toBe(true);
    // Separate logical database on the same host is allowed.
    expect(
      validateProductionRedisTopology('redis://shared.example/0', 'redis://shared.example/1'),
    ).toBe(true);
    // Dedicated host is allowed (recommended production isolation).
    expect(
      validateProductionRedisTopology('redis://cache.example/0', 'redis://bullmq.example/0'),
    ).toBe(true);
    // Identical endpoint is still valid.
    expect(
      validateProductionRedisTopology('redis://shared.example/0', 'redis://shared.example/0'),
    ).toBe(true);
    // A non-parseable override is rejected.
    expect(validateProductionRedisTopology('redis://cache.example/0', 'not a url')).toBe(false);
  });
});
