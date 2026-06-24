/** Coarse device family and browser parsed from a `User-Agent` header for display in a session list. */
export interface ParsedUserAgent {
  /** Operating-system / device family (e.g. `"iPhone"`, `"Android"`, `"Mac"`, `"Windows"`), or null. */
  device: string | null;
  /** Browser family (e.g. `"Chrome"`, `"Safari"`, `"Firefox"`, `"Edge"`), or null. */
  browser: string | null;
}

/** Ordered device-family matchers — first hit wins, so more specific tokens precede generic ones. */
const DEVICE_MATCHERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iphone/i, 'iPhone'],
  [/ipad/i, 'iPad'],
  [/android/i, 'Android'],
  [/cros/i, 'Chromebook'],
  [/macintosh|mac os x/i, 'Mac'],
  [/windows/i, 'Windows'],
  [/linux/i, 'Linux'],
];

/** Ordered browser matchers — Edge/Opera precede Chrome, and Chrome precedes Safari, because their tokens overlap. */
const BROWSER_MATCHERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/edg(?:e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/firefox\/|fxios\//i, 'Firefox'],
  [/chrome\/|crios\//i, 'Chrome'],
  [/safari\//i, 'Safari'],
];

/** Returns the label of the first matcher whose pattern is present in `userAgent`, or null. */
function matchFirst(
  userAgent: string,
  matchers: ReadonlyArray<readonly [RegExp, string]>,
): string | null {
  for (const [pattern, label] of matchers) {
    if (pattern.test(userAgent)) {
      return label;
    }
  }
  return null;
}

/**
 * Parse a raw `User-Agent` string into a coarse `{ device, browser }` pair for the sessions UI.
 *
 * @param userAgent - The stored `auth.sessions.user_agent`, or null/undefined.
 * @returns Best-effort device and browser families; either field is `null` when no known token
 *   matches (or the input is empty). Deterministic and dependency-free.
 *
 * @remarks
 * Intentionally heuristic and lightweight — it is a display hint, not a security control, so it
 * favours zero dependencies over exhaustive coverage. Token order matters (e.g. `Edg/` is checked
 * before `Chrome/` because Chromium-based Edge sends both); unknown agents degrade to `null`.
 */
export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  if (!userAgent) {
    return { device: null, browser: null };
  }
  return {
    device: matchFirst(userAgent, DEVICE_MATCHERS),
    browser: matchFirst(userAgent, BROWSER_MATCHERS),
  };
}
