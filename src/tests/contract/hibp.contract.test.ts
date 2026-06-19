import { createHash } from 'node:crypto';
import nock from 'nock';
import { describe, expect, test } from 'vitest';
import { isPasswordBreached } from '@/shared/utils/security/password-strength.util.js';
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';

registerThirdPartyContractTestIsolationHooks();

const HIBP_HOSTNAME = 'https://api.pwnedpasswords.com';

/** Splits a password's uppercase SHA-1 into the 5-char range prefix and 35-char suffix HIBP uses. */
function sha1RangeParts(password: string): { prefix: string; suffix: string } {
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

describe('HaveIBeenPwned breach-check contract (`isPasswordBreached`)', () => {
  test('sends only the 5-char prefix (k-anonymity) and reports true on a non-zero-count hit', async () => {
    const password = 'password';
    const { prefix, suffix } = sha1RangeParts(password);
    nock(HIBP_HOSTNAME)
      .get(`/range/${prefix}`)
      .matchHeader('add-padding', 'true')
      .reply(200, `0000000000000000000000000000000000A:0\r\n${suffix}:39021\r\n`);

    await expect(isPasswordBreached(password)).resolves.toBe(true);
  });

  test('reports false when the suffix is absent from the range response', async () => {
    const password = 'a-very-unique-passphrase-not-in-any-corpus-92x';
    const { prefix, suffix } = sha1RangeParts(password);
    const otherSuffix = suffix.split('').reverse().join('');
    nock(HIBP_HOSTNAME)
      .get(`/range/${prefix}`)
      .reply(200, `${otherSuffix}:5\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1`);

    await expect(isPasswordBreached(password)).resolves.toBe(false);
  });

  test('treats a padded zero-count suffix as not breached', async () => {
    const password = 'padding-decoy-check-7yqz';
    const { prefix, suffix } = sha1RangeParts(password);
    nock(HIBP_HOSTNAME).get(`/range/${prefix}`).reply(200, `${suffix}:0`);

    await expect(isPasswordBreached(password)).resolves.toBe(false);
  });

  test('fails open (returns false) when the range API errors', async () => {
    const password = 'network-down-fail-open';
    const { prefix } = sha1RangeParts(password);
    nock(HIBP_HOSTNAME).get(`/range/${prefix}`).reply(503, 'service unavailable');

    await expect(isPasswordBreached(password)).resolves.toBe(false);
  });
});
