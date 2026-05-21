/** OpenAPI success responses — health, auth, and current user. */
import type { ResponseDefinition } from '../building-blocks.js';
import { wrapPaginated, wrapSuccess } from '../building-blocks.js';
import * as schemas from '../resource-schemas.js';

export const healthAuthUserRouteResponses: Record<string, ResponseDefinition> = {
  // ── Health ──
  'GET /health/live': {
    statusCode: 200,
    schema: { type: 'object', properties: { status: { type: 'string' } } },
    example: { status: 'ok' },
  },
  'GET /health/ready': {
    statusCode: 200,
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        database: { type: 'string' },
        redis: { type: 'string' },
        bullmq: { type: 'string' },
        latencyMs: {
          type: 'object',
          properties: {
            database: { type: 'integer', nullable: true },
            redis: { type: 'integer', nullable: true },
            bullmq: { type: 'integer', nullable: true },
          },
        },
      },
    },
    example: {
      status: 'ok',
      database: 'connected',
      redis: 'connected',
      bullmq: 'connected',
      latencyMs: { database: 4, redis: 2, bullmq: 3 },
    },
  },

  // ── MCP (Model Context Protocol) ──
  'GET /api/v1/mcp': {
    statusCode: 200,
    schema: {
      type: 'object',
      description: 'MCP streamable HTTP response (SSE or JSON per MCP transport)',
      additionalProperties: true,
    },
    example: null,
  },
  'POST /api/v1/mcp': {
    statusCode: 200,
    schema: {
      type: 'object',
      description: 'MCP JSON-RPC 2.0 response (tools/list, resources/list, tools/call, etc.)',
      additionalProperties: true,
    },
    example: {
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [{ name: 'call_api', description: 'Call any core-be REST API endpoint' }],
      },
    },
  },

  // ── Auth ──
  'POST /api/v1/auth/login': {
    statusCode: 200,
    schema: wrapSuccess(schemas.accessTokenSchema, schemas.accessTokenExample),
    example: null,
  },
  'POST /api/v1/auth/logout': { statusCode: 204, schema: null, example: null },
  'POST /api/v1/auth/magic-link/send': {
    statusCode: 200,
    schema: wrapSuccess(schemas.magicLinkSentSchema, schemas.magicLinkSentExample),
    example: null,
  },
  'POST /api/v1/auth/magic-link/verify': {
    statusCode: 200,
    schema: wrapSuccess(schemas.accessTokenSchema, schemas.accessTokenExample),
    example: null,
  },
  'GET /api/v1/auth/oauth/providers': {
    statusCode: 200,
    schema: wrapSuccess(schemas.oauthProvidersSchema, { providers: ['google', 'github'] }),
    example: null,
  },
  'GET /api/v1/auth/oauth/{provider}': {
    statusCode: 302,
    schema: { type: 'object', properties: { redirect_url: { type: 'string', format: 'uri' } } },
    example: { redirect_url: 'https://accounts.google.com/o/oauth2/v2/auth?...' },
  },
  'GET /api/v1/auth/oauth/{provider}/callback': {
    statusCode: 200,
    schema: wrapSuccess(schemas.accessTokenSchema, schemas.accessTokenExample),
    example: null,
  },
  'POST /api/v1/auth/password/forgot': {
    statusCode: 200,
    schema: wrapSuccess(schemas.messageSchema, {
      message: 'If that email exists, a reset link has been sent',
    }),
    example: null,
  },
  'POST /api/v1/auth/password/reset': { statusCode: 204, schema: null, example: null },
  'POST /api/v1/auth/password/change': { statusCode: 204, schema: null, example: null },
  'POST /api/v1/auth/email/verify': {
    statusCode: 200,
    schema: wrapSuccess(schemas.messageSchema, { message: 'Email verified successfully' }),
    example: null,
  },
  'POST /api/v1/auth/email/resend-verification': {
    statusCode: 200,
    schema: wrapSuccess(schemas.messageSchema, { message: 'Verification email sent' }),
    example: null,
  },
  'POST /api/v1/auth/mfa/enroll': {
    statusCode: 200,
    schema: wrapSuccess(schemas.mfaEnrollSchema, schemas.mfaEnrollExample),
    example: null,
  },
  'POST /api/v1/auth/mfa/verify': {
    statusCode: 200,
    schema: wrapSuccess(schemas.mfaVerifiedSchema, { verified: true }),
    example: null,
  },
  'POST /api/v1/auth/mfa/challenge': {
    statusCode: 200,
    schema: wrapSuccess(schemas.accessTokenSchema, schemas.accessTokenExample),
    example: null,
  },
  'GET /api/v1/auth/mfa': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.mfaMethodSchema }, [
      schemas.mfaMethodExample,
    ]),
    example: null,
  },
  'DELETE /api/v1/auth/mfa/{mfaMethodId}': { statusCode: 204, schema: null, example: null },
  'POST /api/v1/auth/refresh': {
    statusCode: 200,
    schema: wrapSuccess(schemas.accessTokenSchema, schemas.accessTokenExample),
    example: null,
  },

  // ── Auth: Sessions ──
  'GET /api/v1/auth/me/sessions': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.sessionSchema }, [schemas.sessionExample]),
    example: null,
  },
  'DELETE /api/v1/auth/me/sessions': { statusCode: 204, schema: null, example: null },
  'DELETE /api/v1/auth/me/sessions/{id}': { statusCode: 204, schema: null, example: null },

  // ── Auth: Auth Methods ──
  'GET /api/v1/auth/me/auth-methods': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.authMethodSchema }, [
      schemas.authMethodExample,
      {
        ...schemas.authMethodExample,
        id: 2,
        method_type: 'oauth',
        provider: 'google',
        is_primary: false,
      },
    ]),
    example: null,
  },
  'POST /api/v1/auth/me/auth-methods': {
    statusCode: 201,
    schema: wrapSuccess(schemas.authMethodSchema, {
      ...schemas.authMethodExample,
      id: 3,
      method_type: 'oauth',
      provider: 'github',
      is_primary: false,
    }),
    example: null,
  },
  'DELETE /api/v1/auth/me/auth-methods/{id}': { statusCode: 204, schema: null, example: null },

  // ── User: Me ──
  'GET /api/v1/users/me': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, schemas.userExample),
    example: null,
  },
  'PATCH /api/v1/users/me': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, schemas.userExample),
    example: null,
  },
  'DELETE /api/v1/users/me': { statusCode: 204, schema: null, example: null },
  'GET /api/v1/users/me/settings': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSettingsSchema, schemas.userSettingsExample),
    example: null,
  },
  'PATCH /api/v1/users/me/settings': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSettingsSchema, schemas.userSettingsExample),
    example: null,
  },
  'GET /api/v1/users/me/notification-preferences': {
    statusCode: 200,
    schema: wrapSuccess(
      { type: 'array', items: schemas.notificationPreferenceSchema },
      schemas.notificationPreferenceExamples,
    ),
    example: null,
  },
  'PUT /api/v1/users/me/notification-preferences': {
    statusCode: 200,
    schema: wrapSuccess(
      { type: 'array', items: schemas.notificationPreferenceSchema },
      schemas.notificationPreferenceExamples,
    ),
    example: null,
  },
  'PUT /api/v1/users/me/avatar': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, {
      ...schemas.userExample,
      avatar_url: 'https://cdn.example.com/avatars/usr_k7x9m2pqr4w8n1v3.png',
    }),
    example: null,
  },
  'DELETE /api/v1/users/me/avatar': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, { ...schemas.userExample, avatar_url: null }),
    example: null,
  },
  'POST /api/v1/users/me/data-export': {
    statusCode: 202,
    schema: wrapSuccess(
      {
        type: 'object',
        properties: {
          export_id: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
          download_url: { type: 'string', nullable: true },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          completed_at: { type: 'string', format: 'date-time', nullable: true },
          failed_at: { type: 'string', format: 'date-time', nullable: true },
          error_code: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
        required: ['export_id', 'status', 'created_at'],
      },
      {
        export_id: 'exp_k7x9m2pqr4w8n1v3',
        status: 'pending',
        download_url: null,
        expires_at: '2026-05-27T12:00:00.000Z',
        completed_at: null,
        failed_at: null,
        error_code: null,
        created_at: '2026-05-20T12:00:00.000Z',
      },
    ),
    example: null,
  },
  'GET /api/v1/users/me/data-export/{exportId}': {
    statusCode: 200,
    schema: wrapSuccess(
      {
        type: 'object',
        properties: {
          export_id: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
          download_url: { type: 'string', nullable: true },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          completed_at: { type: 'string', format: 'date-time', nullable: true },
          failed_at: { type: 'string', format: 'date-time', nullable: true },
          error_code: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
        required: ['export_id', 'status', 'created_at'],
      },
      {
        export_id: 'exp_k7x9m2pqr4w8n1v3',
        status: 'completed',
        download_url: 'https://bucket.s3.amazonaws.com/user-data-export/usr/exp.json.gz?X-Amz-Signature=example',
        expires_at: '2026-05-27T12:00:00.000Z',
        completed_at: '2026-05-20T12:05:00.000Z',
        failed_at: null,
        error_code: null,
        created_at: '2026-05-20T12:00:00.000Z',
      },
    ),
    example: null,
  },

  // ── Admin: Users ──
};
