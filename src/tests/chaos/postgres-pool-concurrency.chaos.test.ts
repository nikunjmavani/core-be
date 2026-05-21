import { describe, expect, it } from 'vitest';

import { sql } from '@/infrastructure/database/connection.js';

/**
 * High-concurrency simple queries through the shared postgres.js pool.
 * With Neon pooler URLs, `prepare: false` avoids "prepared statement does not exist" under churn.
 */
describe('Chaos resilience: Postgres pool concurrency', () => {
  it('completes many parallel lightweight queries without connection errors', async () => {
    const concurrentQueryCount = 100;

    const results = await Promise.all(
      Array.from(
        { length: concurrentQueryCount },
        (_, index) => sql<{ value: number }[]>`SELECT ${index}::int AS value`,
      ),
    );

    expect(results).toHaveLength(concurrentQueryCount);
    for (const [index, rows] of results.entries()) {
      expect(rows[0]?.value).toBe(index);
    }
  });
});
