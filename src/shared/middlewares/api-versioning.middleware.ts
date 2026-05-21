import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  alertDeprecatedUsagePastSunset,
  applyDeprecatedEndpointHeaders,
  applyPublicApiVersionHeader,
  buildPublicApiPrefix,
  isPastSunset,
  parseHttpDate,
  PUBLIC_API_V1_SUNSET,
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

function recordSuccessfulResponsePastSunsetHeader(
  request: { method: string; url: string },
  reply: { statusCode: number; getHeader: (name: string) => unknown },
): void {
  const sunsetHeader = reply.getHeader('Sunset');
  if (typeof sunsetHeader !== 'string') {
    return;
  }
  const sunset = parseHttpDate(sunsetHeader);
  if (!(sunset && isPastSunset(sunset)) || reply.statusCode < 200 || reply.statusCode >= 400) {
    return;
  }
  alertDeprecatedUsagePastSunset({
    surface: `sunset-header:${requestPathWithoutQuery(request.url)}`,
    sunset,
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
  });
}

const apiVersioningMiddleware: FastifyPluginAsync = async (application) => {
  application.addHook('onSend', async (request, reply, payload) => {
    if (isPublicApiV1Request(request.url)) {
      applyPublicApiVersionHeader(reply);

      if (PUBLIC_API_V1_SUNSET) {
        applyDeprecatedEndpointHeaders(reply, {
          sunset: PUBLIC_API_V1_SUNSET,
          deprecation: true,
        });
        if (
          isPastSunset(PUBLIC_API_V1_SUNSET) &&
          reply.statusCode >= 200 &&
          reply.statusCode < 400
        ) {
          alertDeprecatedUsagePastSunset({
            surface: 'public-api-v1',
            sunset: PUBLIC_API_V1_SUNSET,
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode,
          });
        }
      }
    }

    recordSuccessfulResponsePastSunsetHeader(request, reply);

    return payload;
  });
};

export default fp(apiVersioningMiddleware, { name: 'api-versioning-middleware' });
