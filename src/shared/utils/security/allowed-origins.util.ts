/**
 * Parses the comma-separated ALLOWED_ORIGINS env value the same way CORS does.
 */
export function parseAllowedOriginsList(allowedOriginsValue: string | undefined): string[] {
  const allowed = allowedOriginsValue ?? '';
  return allowed
    .split(',')
    .map((segment: string) => segment.trim())
    .filter(Boolean);
}
