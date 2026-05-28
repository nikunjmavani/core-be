/** Stable Toxiproxy proxy names wired in provision-proxies and chaos suites. */

/** Toxiproxy proxy name fronting Postgres in chaos tests. */
export const CHAOS_POSTGRES_PROXY_NAME = 'chaos-postgres';

/** Toxiproxy proxy name fronting Redis in chaos tests. */
export const CHAOS_REDIS_PROXY_NAME = 'chaos-redis';

/** Default listen host for the Postgres chaos proxy (matches docker-compose chaos profile). */
export const DEFAULT_CHAOS_POSTGRES_PROXY_LISTEN_HOST = '0.0.0.0';

/** Default listen port for the Postgres chaos proxy; tests connect through this port instead of 5432. */
export const DEFAULT_CHAOS_POSTGRES_PROXY_LISTEN_PORT = 25_432;

/** Default listen host for the Redis chaos proxy (matches docker-compose chaos profile). */
export const DEFAULT_CHAOS_REDIS_PROXY_LISTEN_HOST = '0.0.0.0';

/** Default listen port for the Redis chaos proxy; tests connect through this port instead of 6379. */
export const DEFAULT_CHAOS_REDIS_PROXY_LISTEN_PORT = 26_379;
