import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  applyPublicApiVersionHeader,
  buildPublicApiPrefix,
  PUBLIC_API_VERSION_HEADER,
  PUBLIC_API_VERSION_SEGMENT_V1,
  PUBLIC_API_VERSION_VALUE_V1,
} from '@/shared/utils/http/api-versioning.util.js';

describe('api-versioning.util', () => {
  it('buildPublicApiPrefix combines /api with segment', () => {
    expect(buildPublicApiPrefix(PUBLIC_API_VERSION_SEGMENT_V1)).toBe('/api/v1');
    expect(buildPublicApiPrefix('v2')).toBe('/api/v2');
  });

  it('applyPublicApiVersionHeader sets API-Version', () => {
    const header = vi.fn();
    const reply = { header } as unknown as FastifyReply;
    applyPublicApiVersionHeader(reply);
    expect(header).toHaveBeenCalledWith(PUBLIC_API_VERSION_HEADER, PUBLIC_API_VERSION_VALUE_V1);
  });
});
