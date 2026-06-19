import { createHash } from 'node:crypto';
import { ZxcvbnFactory, type OptionsType } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';
import {
  dictionary as englishDictionary,
  translations as englishTranslations,
} from '@zxcvbn-ts/language-en';
import { getEnv } from '@/shared/config/env.config.js';
import { MINIMUM_ACCEPTABLE_PASSWORD_SCORE } from '@/shared/constants/security.constants.js';
import { PROJECT_SLUG } from '@/shared/constants/project-identity.constants.js';
import { ValidationError } from '@/shared/errors/index.js';
import { buildOutboundCallOptions, outboundCall } from '@/infrastructure/outbound/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** HaveIBeenPwned k-anonymity range endpoint; the SHA-1 prefix is appended as `/range/{prefix}`. */
const HIBP_RANGE_API_BASE_URL = 'https://api.pwnedpasswords.com/range';

/**
 * Lazily-constructed zxcvbn engine. Building it loads the common + English dictionaries and the
 * keyboard-adjacency graphs into ranked maps (a few MB, ~tens of ms), so it is created once per
 * process on first use rather than at module load.
 */
let cachedZxcvbnFactory: ZxcvbnFactory | null = null;

function getZxcvbnFactory(): ZxcvbnFactory {
  if (cachedZxcvbnFactory) {
    return cachedZxcvbnFactory;
  }
  const options: OptionsType = {
    translations: englishTranslations,
    graphs: adjacencyGraphs,
    dictionary: { ...commonDictionary, ...englishDictionary },
  };
  cachedZxcvbnFactory = new ZxcvbnFactory(options);
  return cachedZxcvbnFactory;
}

/** Outcome of {@link assessPasswordStrength}: the 0–4 zxcvbn score plus its localized feedback. */
export interface PasswordStrengthAssessment {
  /** zxcvbn score: 0 (too guessable) … 4 (very unguessable). */
  score: number;
  /** A single high-level warning when the password is weak, or `null`. */
  warning: string | null;
  /** Actionable suggestions for a stronger password (may be empty). */
  suggestions: string[];
}

/**
 * Scores a candidate password with zxcvbn, optionally penalizing tokens derived from
 * `userInputs` (e.g. the account email) so passwords built from the user's own data score low.
 *
 * @remarks
 * - **Algorithm:** delegates to a process-wide {@link ZxcvbnFactory} seeded with the common +
 *   English dictionaries and keyboard-adjacency graphs; returns the raw 0–4 score and feedback.
 * - **Failure modes:** pure and synchronous — never throws or performs I/O. Callers decide whether
 *   a given score is acceptable (see {@link assertPasswordAcceptable}).
 * - **Side effects:** constructs and caches the zxcvbn engine on first call.
 */
export function assessPasswordStrength(options: {
  password: string;
  userInputs?: string[] | undefined;
}): PasswordStrengthAssessment {
  const result = getZxcvbnFactory().check(options.password, options.userInputs ?? []);
  return {
    score: result.score,
    warning: result.feedback.warning,
    suggestions: result.feedback.suggestions,
  };
}

/** Returns true when the range-API body lists `suffix` with a breach count greater than zero. */
function hibpRangeBodyContainsSuffix(rangeBody: string, suffix: string): boolean {
  for (const line of rangeBody.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    const candidateSuffix = line.slice(0, separatorIndex).trim().toUpperCase();
    if (candidateSuffix !== suffix) {
      continue;
    }
    // With `Add-Padding`, HIBP injects decoy suffixes with a count of 0; a real hit has count > 0.
    const breachCount = Number.parseInt(line.slice(separatorIndex + 1).trim(), 10);
    return Number.isFinite(breachCount) && breachCount > 0;
  }
  return false;
}

/**
 * Reports whether `password` appears in the HaveIBeenPwned breach corpus, using the k-anonymity
 * range API so the full password (or its complete hash) never leaves the process.
 *
 * @remarks
 * - **Algorithm:** SHA-1 the password, send only the first 5 hex chars to
 *   `GET /range/{prefix}` (with `Add-Padding: true`), then match the remaining 35-char suffix
 *   locally against the returned `SUFFIX:COUNT` lines.
 * - **Failure modes:** fails OPEN — any transport error, non-2xx, timeout, or open circuit is
 *   logged at `warn` and returns `false` (treated as not-breached). Availability of a password
 *   change must never depend on a third party; zxcvbn still enforces a strength floor.
 * - **Side effects:** one outbound HTTPS request via {@link outboundCall} (timeout from the
 *   `hibp` integration defaults). No persistence.
 */
export async function isPasswordBreached(
  password: string,
  options?: { requestId?: string | undefined },
): Promise<boolean> {
  const sha1HashUppercase = createHash('sha1').update(password).digest('hex').toUpperCase();
  const hashPrefix = sha1HashUppercase.slice(0, 5);
  const hashSuffix = sha1HashUppercase.slice(5);

  try {
    return await outboundCall(
      buildOutboundCallOptions({
        name: 'hibp',
        requestId: options?.requestId,
        operation: async (signal) => {
          const response = await fetch(`${HIBP_RANGE_API_BASE_URL}/${hashPrefix}`, {
            method: 'GET',
            headers: { 'Add-Padding': 'true', 'User-Agent': PROJECT_SLUG },
            signal,
          });
          if (!response.ok) {
            throw new Error(`HIBP range API responded with status ${response.status}`);
          }
          const rangeBody = await response.text();
          return hibpRangeBodyContainsSuffix(rangeBody, hashSuffix);
        },
      }),
    );
  } catch (error) {
    // Fail-open: a HIBP outage degrades to zxcvbn-only rather than blocking the password write.
    logger.warn({ error }, 'password.hibp.check.failed');
    return false;
  }
}

/**
 * Enforces the password-strength policy on a newly chosen password (set / reset / change),
 * throwing a {@link ValidationError} bound to `field` when the password is too weak or breached.
 *
 * @remarks
 * - **Algorithm:** no-op when `PASSWORD_STRENGTH_CHECK_ENABLED` is off. Otherwise rejects below
 *   {@link MINIMUM_ACCEPTABLE_PASSWORD_SCORE} (zxcvbn), then — when `PASSWORD_HIBP_CHECK_ENABLED`
 *   is on — rejects passwords found via {@link isPasswordBreached}.
 * - **Failure modes:** throws `ValidationError('errors:validation.weakPassword')` or
 *   `('errors:validation.breachedPassword')`, each carrying a single `field` entry so the API
 *   response points at the offending body field (`password` / `new_password`). The HIBP step is
 *   fail-open and never throws for transport errors.
 * - **Side effects:** reads env via `getEnv()` at call time (so per-process flag flips apply) and
 *   may issue one outbound HIBP request.
 */
export async function assertPasswordAcceptable(options: {
  password: string;
  field: string;
  userInputs?: string[] | undefined;
  requestId?: string | undefined;
}): Promise<void> {
  const env = getEnv();
  if (!env.PASSWORD_STRENGTH_CHECK_ENABLED) {
    return;
  }

  const { score } = assessPasswordStrength({
    password: options.password,
    userInputs: options.userInputs,
  });
  if (score < MINIMUM_ACCEPTABLE_PASSWORD_SCORE) {
    throw new ValidationError('errors:validation.weakPassword', undefined, undefined, [
      { field: options.field, messageKey: 'errors:validation.weakPassword' },
    ]);
  }

  if (env.PASSWORD_HIBP_CHECK_ENABLED) {
    const breached = await isPasswordBreached(options.password, { requestId: options.requestId });
    if (breached) {
      throw new ValidationError('errors:validation.breachedPassword', undefined, undefined, [
        { field: options.field, messageKey: 'errors:validation.breachedPassword' },
      ]);
    }
  }
}
