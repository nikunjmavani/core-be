import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipPromisified = promisify(gzip);

/**
 * Gzip a buffer asynchronously on the libuv thread pool.
 *
 * @remarks
 * - **Algorithm:** delegates to `zlib.gzip` via `promisify`, so compression runs
 *   off the main thread.
 * - **Failure modes:** rejects with the underlying `zlib` error if compression fails.
 * - **Side effects:** none.
 * - **Notes:** prefer this over `gzipSync` inside workers — synchronous gzip blocks
 *   the event loop, which can stall BullMQ job-lock renewal and trigger spurious
 *   stalled-job reprocessing on large payloads.
 */
export async function gzipBufferAsync(input: Buffer): Promise<Buffer> {
  return gzipPromisified(input);
}
