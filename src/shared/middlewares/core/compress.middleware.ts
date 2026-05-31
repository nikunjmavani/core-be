import type { FastifyPluginAsync } from 'fastify';
import fastifyCompress from '@fastify/compress';

const compressMiddleware: FastifyPluginAsync = async (app) => {
  await app.register(fastifyCompress, {
    global: true,
    threshold: 1024, // Only compress responses > 1 KB
    // Brotli is enabled by default in @fastify/compress when the runtime supports it.
    // Prefer brotli for large JSON payloads; gzip remains the fallback for older clients.
    encodings: ['br', 'gzip', 'deflate'],
  });
};

export default compressMiddleware;
