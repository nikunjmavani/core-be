import { z } from 'zod';
import { SLUG_REGEX } from '@/shared/constants/index.js';

/**
 * String schema that trims leading and trailing whitespace.
 * Use for request/query string fields so "  value  " becomes "value".
 * Declared as ZodString so callers can chain .max() / .min(); runtime returns compatible schema.
 */
export function trimmedString(): z.ZodString {
  return z.string().trim() as unknown as z.ZodString;
}

/**
 * Trimmed string with length bounds. Use .min(1) to reject whitespace-only input.
 */
export function trimmedStringMinMax(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max) as unknown as z.ZodString;
}

const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com'] as const;

/**
 * Trimmed email (lowercased for canonical storage).
 * Gmail and Googlemail addresses may not use "+" in the local part (plus addressing not allowed).
 */
export function trimmedEmail(): z.ZodType<string> {
  return z
    .string()
    .trim()
    .toLowerCase()
    .max(255)
    .pipe(z.email())
    .refine(
      (email) => {
        const atIndex = email.indexOf('@');
        if (atIndex === -1) return true;
        const localPart = email.slice(0, atIndex);
        const domain = email.slice(atIndex + 1);
        const isGmailDomain = GMAIL_DOMAINS.includes(domain as (typeof GMAIL_DOMAINS)[number]);
        if (!isGmailDomain) return true;
        return !localPart.includes('+');
      },
      { message: 'Plus addressing is not allowed for Gmail addresses' },
    );
}

/**
 * Trimmed slug matching SLUG_REGEX (lowercase alphanumeric and hyphens).
 * Declared as ZodType<string> because .regex() returns ZodEffects.
 */
export function trimmedSlug(): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(SLUG_REGEX, 'Slug must be lowercase alphanumeric and hyphens only');
}

/** Escapes SQL LIKE wildcards (`%`, `_`, `\`) in user-provided search terms. */
export function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * audit R13: returns false when a client-supplied storage object key contains a path-traversal
 * segment (`..`) or any ASCII control character (`\x00`–`\x1f`). S3 treats keys as opaque literals
 * (so traversal is not exploitable on the bucket today) and confirmed-upload keys are owner-bound by
 * exact match — but rejecting traversal here makes the no-traversal invariant explicit rather than
 * incidental, so it survives any future consumer that derives a path or normalizes the key.
 */
export function isTraversalFreeStorageKey(key: string): boolean {
  return !(key.includes('..') || [...key].some((char) => char.charCodeAt(0) <= 0x1f));
}
