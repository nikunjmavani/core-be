import type { FastifyRequest } from 'fastify';
import i18next from 'i18next';

export type MessageKeyPayload = {
  messageKey: string;
  messageParams?: Record<string, string | number>;
};

/** Translates a success messageKey for HTTP responses (controller layer). */
export function translateMessageKeyPayload(
  request: FastifyRequest,
  payload: MessageKeyPayload,
): { message: string } {
  const translate = (
    request as { t?: (key: string, params?: Record<string, string | number>) => string }
  ).t;
  const language = (request as { language?: string }).language ?? 'en';
  return {
    message: translate
      ? translate(payload.messageKey, payload.messageParams ?? {})
      : i18next.t(payload.messageKey, { lng: language, ...(payload.messageParams ?? {}) }),
  };
}
