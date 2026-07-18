import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  applyPublicApiVersionHeader,
  buildPublicApiPrefix,
  PUBLIC_API_VERSION_SEGMENT_V1,
} from '@/shared/utils/http/api-versioning.util.js';

const publicApiV1Prefix = buildPublicApiPrefix(PUBLIC_API_VERSION_SEGMENT_V1);

function requestPathWithoutQuery(url: string): string {
  return url.split('?')[0] ?? url;
}

function isPublicApiV1Request(url: string): boolean {
  const path = requestPathWithoutQuery(url);
  return path === publicApiV1Prefix || path.startsWith(`${publicApiV1Prefix}/`);
}

const apiVersioningMiddleware: FastifyPluginAsync = async (application) => {
  application.addHook('onSend', async (request, reply, payload) => {
    if (isPublicApiV1Request(request.url)) {
      applyPublicApiVersionHeader(reply);
    }
    return payload;
  });
};

export default fp(apiVersioningMiddleware, { name: 'api-versioning-middleware' });
