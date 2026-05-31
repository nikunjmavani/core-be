import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';

const cookieMiddleware: FastifyPluginAsync = async (app) => {
  await app.register(cookie, {
    // No signing — session_id is a cryptographic random value.
    // Security relies on httpOnly + Secure + SameSite flags.
    parseOptions: {},
  });
};

export default fp(cookieMiddleware, { name: 'cookie-middleware' });
