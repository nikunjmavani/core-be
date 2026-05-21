import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of a Bearer authorization header against an expected token.
 */
export function isBearerTokenValid(
  authorizationHeader: string | undefined,
  expectedBearerToken: string,
): boolean {
  if (!authorizationHeader) {
    return false;
  }
  const expectedHeader = `Bearer ${expectedBearerToken}`;
  const provided = Buffer.from(authorizationHeader);
  const expected = Buffer.from(expectedHeader);
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
