/**
 * Location of the committed, sanitized request/response examples captured from
 * real test-suite API calls (`ROUTE_EXAMPLE_CAPTURE=1 pnpm test` then
 * `pnpm routes:examples`). Consumed by the OpenAPI emitters; keyed by
 * `"METHOD /catalog/:param/path"`.
 */
export const ROUTE_EXAMPLES_PATH = 'tooling/openapi/route-examples/route-examples.json';
