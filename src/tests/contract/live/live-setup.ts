/**
 * Setup for the live contract slice (`pnpm test:contract:live`).
 *
 * Deliberately minimal, and deliberately NOT `src/tests/setup.ts`:
 *
 * 1. It must not set `CONTRACT_TESTS_ENABLED`. That flag makes `src/tests/setup.ts`
 *    **hard-overwrite** `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, and every S3 variable with
 *    placeholders — correct for the offline tier, fatal here, since it would silently replace
 *    the real sandbox credentials this slice exists to exercise.
 * 2. It must not activate nock or mock Redis. The whole point is real outbound HTTP.
 *
 * All it does is load the environment files so `env.config` can validate, exactly as the
 * application does at boot.
 */
import '@/shared/config/load-env-files.js';
