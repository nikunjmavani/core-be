import { describe, expect, it } from 'vitest';
import {
  deriveBullMqRedisUrlFromCacheUrl,
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

  it('usesSeparateBullMqRedisHost is false for same host different logical DB', () => {
    expect(
      usesSeparateBullMqRedisHost('redis://localhost:6379/0', 'redis://localhost:6379/1'),
    ).toBe(false);
  });

  it('usesSeparateBullMqRedisHost is true for different hosts', () => {
    expect(
      usesSeparateBullMqRedisHost(
        'redis://cache.example.upstash.io:6379/0',
        'redis://bullmq.example.upstash.io:6379/0',
      ),
    ).toBe(true);
  });

  it('usesSeparateBullMqRedisEndpoint is true for same host different logical DB', () => {
    expect(
      usesSeparateBullMqRedisEndpoint('redis://localhost:6379/0', 'redis://localhost:6379/1'),
    ).toBe(true);
  });

  it('validateProductionRedisTopology allows a single shared Redis endpoint', () => {
    expect(validateProductionRedisTopology('redis://cache.example/0', undefined)).toBe(true);
    expect(
      validateProductionRedisTopology('redis://shared.example/0', 'redis://shared.example/1'),
    ).toBe(false);
    expect(
      validateProductionRedisTopology('redis://cache.example/0', 'redis://bullmq.example/0'),
    ).toBe(false);
    expect(
      validateProductionRedisTopology('redis://shared.example/0', 'redis://shared.example/0'),
    ).toBe(true);
  });
});
