import '@/shared/config/load-env-files.js';

process.env.NODE_ENV ??= 'test';

const TEST_JWT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDJp33Skforij0b
cb5iPkuY7IeTw+X6NuKmkadoCS7aRaQgkon9u/s1Lj05tRuZTgw0VqfYiIbud2z1
PWJtl4niSyG8cjNdglpUkNW1f7oaDC9YoGfup5telmZy5vK5IVieT0fn5ePLRdlk
bMkOf2fHcx/rRf4Vl+ff9E9BXLmYg1yqkKPxHBBwZPcqmQ2DW3An7DEUS/ZDw8AE
UIBHRurFQOYZ1xzov/w21a0l+qT911yk5TJKl+ffeeQQ5twiiDMQEQQoJDKJOXo3
UsuFycfSgkJV2KnzK9QsHrHYrM44cD08yIctf1/I3Z3xwVms8Bof6pv0q96Lueh1
D+ECdd4BAgMBAAECggEABUwGhJT8Ds+7SjDDMP506ufvqcSAEoIFkx2JWbTAC9C/
fnGK+WTKNPvpdM4akvzXWjqafxga/0GY1ZpOrxVHdG/Hy5TuX3rwl38UdgeMYmnG
hpv0DvNNI/9sYoFJh+5lzwbDG0bRJIJJsxcecuiK19Tg1kPI6FVMrHfU6yEd6PEi
d5/igyxkxxcPr96BlNkKl+7CAYqY88t5uwXbnbxAmxLIMQ6f26T+1vCCJnHpRakS
UygAQLJFXJzOTV2j1mMIyZi28DNR7+QRYzHeYTBe+e3dsaxC14+veVMjKpWS+AIX
eqoCbyZhDPtYowR9iAO/P1jGPAv9EnEKJZxDCdt65wKBgQDts2fuTmxAFNZg3umt
hpUXuxmnzKdkrU8Vtqmwet3MdETIBAUbWnP+l4LgMj1N3CB77/DGWGiSpLKyXWZf
oQFEv4XVf6ikKzl11ILouCsaiiR7y5Xqjt2Q1tm7fXZ3ntzsX4jGJ3X8H1KRet63
/JP/lPsQqcbZSi8kdrDIvX71HwKBgQDZLa6stFKU4IaEA9SiLxgRpOhBtQB4i+iB
L5l7UZkGn5fscNtQG5c9NFnZ0n6NslsNlShCgGuNAyL1mQph4iG1ozmJYeHruWFO
CA/3wyxL1alzCPdZxtIDPRZ+F+LnzPHlT4hPA/uHmIgOkQn1HPMAul7D5wEby6y7
a69f7b6o3wKBgDiAPqIcrgqFaXfZRL5kkSf052JFeTyrHXNR2gADFJm2wWqx2ezo
kU3hAdD84CmTu3z6Scc72I+S6o8POHheswh+ZfebwqBTTfM+MmfS7xv93jI28Emy
7+Ovzk2Mww4oCud8xewkER1+7Id8J1ighyVnak5JrOSVh6MpO1hcAsONAoGAerRY
0LNBRWRmHAieBtRc4PsvTpCZp4JE51ihew9rSla5W5mYD/bGyInfijZn0l9HGrF/
gbNVEOMIyYKiXxOIwDtssrZfEvQ2igP8IZxgVqhtiNU0C8FNvw6wuqV8SkN9GHaL
KTmyz7XaiYBhA+BLW8nw6PaHpdC501rQR37oDjkCgYAUYS5GwaSz9O6UQAN3/TxS
cpwfpB+Vt5zOcukuHOw0IWNjxI3DGglfjeipNJSXMAlUfoMrXuTpt2YjYs2gJH1U
caaEEWY15kCKLmEjbKIIechhSi5FUlyJ118JbioPVgXDhvxara1wGITfk6APhvCL
LjeTy3MMidIN1gyTCnBPWQ==
-----END PRIVATE KEY-----
`;

const TEST_JWT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyad90pH6K4o9G3G+Yj5L
mOyHk8Pl+jbippGnaAku2kWkIJKJ/bv7NS49ObUbmU4MNFan2IiG7nds9T1ibZeJ
4kshvHIzXYJaVJDVtX+6GgwvWKBn7qebXpZmcubyuSFYnk9H5+Xjy0XZZGzJDn9n
x3Mf60X+FZfn3/RPQVy5mINcqpCj8RwQcGT3KpkNg1twJ+wxFEv2Q8PABFCAR0bq
xUDmGdcc6L/8NtWtJfqk/ddcpOUySpfn33nkEObcIogzEBEEKCQyiTl6N1LLhcnH
0oJCVdip8yvULB6x2KzOOHA9PMiHLX9fyN2d8cFZrPAaH+qb9Kvei7nodQ/hAnXe
AQIDAQAB
-----END PUBLIC KEY-----
`;

function normalizeTestPem(value: string | undefined, marker: string, fallback: string): string {
  if (!value?.includes(marker) || value.includes('__REPLACE_ME__') || value.includes('...')) {
    return fallback;
  }
  return value.replaceAll('\\n', '\n');
}

process.env.JWT_PRIVATE_KEY = normalizeTestPem(
  process.env.JWT_PRIVATE_KEY,
  'BEGIN PRIVATE KEY',
  TEST_JWT_PRIVATE_KEY,
);
process.env.JWT_PUBLIC_KEY = normalizeTestPem(
  process.env.JWT_PUBLIC_KEY,
  'BEGIN PUBLIC KEY',
  TEST_JWT_PUBLIC_KEY,
);
// Suppress BullMQ Redis eviction policy warning in tests (local/CI Redis often uses volatile-lru)
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const message = typeof args[0] === 'string' ? args[0] : String(args[0]);
  if (message.includes('Eviction policy is') && message.includes('noeviction')) return;
  originalWarn.apply(console, args);
};
process.env.LOG_LEVEL ??= 'info';
process.env.PORT ??= '3000';
process.env.HTTP_BIND_HOST = '127.0.0.1';
// Prefer local Docker Postgres for tests (see docker-compose.yml) even when .env points elsewhere
process.env.USE_LOCAL_TEST_DATABASE ??= 'true';
process.env.DATABASE_URL ??= 'postgresql://core:core@localhost:5432/core';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RUN_REDIS_TESTS ??= '1';
process.env.JWT_SECRET ??= 'test-jwt-secret-min-32-chars-xxxxxxxx';
process.env.SECRETS_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.METRICS_SCRAPE_TOKEN ??= 'test-metrics-bearer-token-min-32-chars';
process.env.DATABASE_SSL_ENABLED ??= 'false';
process.env.COOKIE_SECURE ??= 'false';
/** Local `.env` may set a short Stripe webhook signing secret — HMAC helpers require plausible length under test */
if (
  process.env.NODE_ENV === 'test' &&
  process.env.STRIPE_WEBHOOK_SECRET !== undefined &&
  process.env.STRIPE_WEBHOOK_SECRET.length > 0 &&
  process.env.STRIPE_WEBHOOK_SECRET.length < 32
) {
  process.env.STRIPE_WEBHOOK_SECRET =
    'whsec_test_contract_fixture_fallback_when_local_secret_below_32_xx';
}

/**
 * Isolated outbound contract slice (`pnpm test:contract`): force placeholders so `.env`
 * sandbox keys / bucket names / regions never leak into mocks (or vice versa).
 */
if (process.env.CONTRACT_TESTS_ONLY === 'true') {
  process.env.STRIPE_SECRET_KEY = 'sk_test_contract_fixture_key_for_nock_stubs';
  process.env.STRIPE_WEBHOOK_SECRET =
    'whsec_test_contract_fixture_webhook_signing_must_be_minimum_32characters';
  process.env.RESEND_API_KEY = 're_test_contract_fixture_key';
  process.env.S3_BUCKET = 'contract-test-bucket';
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
  process.env.S3_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
}

/**
 * Offline contract tests — infra wrappers require env before nock stubs network (non-overriding baseline).
 */
process.env.STRIPE_SECRET_KEY ??= 'sk_test_contract_fixture_key';
process.env.STRIPE_WEBHOOK_SECRET ??=
  'whsec_test_contract_fixture_secret_minimum_length_32_chars_xx';
process.env.RESEND_API_KEY ??= 're_test_contract_fixture_key';
process.env.S3_BUCKET ??= 'contract-test-bucket';
process.env.S3_REGION ??= 'us-east-1';
process.env.S3_ACCESS_KEY_ID ??= 'AKIAIOSFODNN7EXAMPLE';
process.env.S3_SECRET_ACCESS_KEY ??= 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

process.env.ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.RATE_LIMIT_MAX ??= '1000';
process.env.RATE_LIMIT_WINDOW_MS ??= '60000';
process.env.AUDIT_RETENTION_DAYS ??= '90';
process.env.AUTH_SESSION_RETENTION_DAYS ??= '30';
process.env.ENABLE_QUEUE_DASHBOARD ??= 'true';
process.env.ENABLE_MCP_SERVER ??= 'true';
// Allow disposable emails in tests so flows using yopmail/mailinator etc. can run
if (process.env.NODE_ENV === 'test') {
  process.env.BLOCK_DISPOSABLE_EMAIL = 'false';
}
const { resetEnvCacheForTests } = await import('@/shared/config/env.config.js');
const { resetJwtCachesForTests } = await import('@/shared/utils/security/jwt.util.js');
resetJwtCachesForTests();
resetEnvCacheForTests();
