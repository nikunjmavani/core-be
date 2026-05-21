/**
 * Long-running memory soak for API + worker RSS observation (nightly / manual).
 *
 * Usage:
 *   pnpm tool:memory-soak
 *   MEMORY_SOAK_MINUTES=30 pnpm tool:memory-soak
 */
import '@/shared/config/load-env-files.js';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const SOAK_MINUTES = Number(process.env.MEMORY_SOAK_MINUTES ?? 30);
const SAMPLE_INTERVAL_MS = Number(process.env.MEMORY_SOAK_SAMPLE_MS ?? 60_000);

function rssMegabytes(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

async function main(): Promise<void> {
  const apiProcess = spawn('pnpm', ['dev'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const workerProcess = spawn('pnpm', ['dev:worker'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const endAt = Date.now() + SOAK_MINUTES * 60_000;
  const samples: Array<{ at: string; rssMb: number }> = [];

  try {
    while (Date.now() < endAt) {
      samples.push({ at: new Date().toISOString(), rssMb: rssMegabytes() });
      await delay(SAMPLE_INTERVAL_MS);
    }

    const peak = Math.max(...samples.map((sample) => sample.rssMb));
    console.log(
      JSON.stringify(
        {
          soakMinutes: SOAK_MINUTES,
          sampleCount: samples.length,
          peakRssMb: peak,
          lastSample: samples.at(-1),
        },
        null,
        2,
      ),
    );
  } finally {
    apiProcess.kill('SIGTERM');
    workerProcess.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
