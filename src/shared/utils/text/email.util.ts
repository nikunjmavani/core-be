import { isDisposableEmail as isDisposableEmailFromPackage } from 'disposable-email-domains-js';
import { getEnv } from '@/shared/config/env.config.js';

const DISPOSABLE_EMAIL_MESSAGE = 'Disposable or temporary email addresses are not allowed';

/**
 * Returns true when BLOCK_DISPOSABLE_EMAIL is true (default) and the email is
 * from a known disposable/temporary domain. Set BLOCK_DISPOSABLE_EMAIL=false
 * to allow disposable emails (e.g. when you need to use them).
 */
export function isDisposableEmailBlocked(email: string): boolean {
  if (!getEnv().BLOCK_DISPOSABLE_EMAIL) return false;
  return isDisposableEmailFromPackage(email);
}

export { DISPOSABLE_EMAIL_MESSAGE };
