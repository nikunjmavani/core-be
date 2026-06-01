import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

/**
 * Enables Zod schemas on route `schema` blocks (incremental adoption alongside JSON Schema).
 */
const zodTypeProviderMiddleware: FastifyPluginAsync = async (application) => {
  application.setValidatorCompiler(validatorCompiler);
  application.setSerializerCompiler(serializerCompiler);
};

export default fp(zodTypeProviderMiddleware, { name: 'zod-type-provider' });
