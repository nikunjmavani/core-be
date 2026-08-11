/**
 * Local replacement for `randomString` from `https://jslib.k6.io/k6-utils/1.4.0/index.js`.
 *
 * k6 resolves remote imports over the network at script load, so any scenario importing
 * jslib fails to start behind a proxy or on an air-gapped runner — `user-journey` and
 * every scenario using `helpers/data.js` aborted with a 403 before executing a single
 * request. A load test should not need CDN egress just to boot.
 *
 * Signature matches jslib 1.4.0: `randomString(length, charset?)`, default charset
 * lowercase a–z.
 */
const DEFAULT_CHARSET = 'abcdefghijklmnopqrstuvwxyz';

export function randomString(length, charset = DEFAULT_CHARSET) {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}
