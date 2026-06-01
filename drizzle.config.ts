import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required for drizzle-kit');
}

export default {
  schema: ['./src/domains/**/*.schema.ts', './src/infrastructure/database/pg-schemas.ts'],
  // Drafting-only scratch dir (gitignored). Drizzle Kit's generated SQL +
  // meta/ snapshot are NOT the source of truth — hand-written, timestamp-named
  // `migrations/*.sql` applied by `pnpm db:migrate` are. Copy anything useful
  // out of ./drizzle into a `pnpm db:migrate:new <slug>` file; never apply from
  // here. See docs/reference/data/migrations.md.
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
} satisfies Config;
