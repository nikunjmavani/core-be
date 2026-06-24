import geoip from 'geoip-lite';

/**
 * Resolve a best-effort, human-readable location string from an IP address using the
 * offline GeoLite database (`geoip-lite`).
 *
 * @param ipAddress - The caller's IP address (e.g. `auth.sessions.ip_address`), or null/undefined.
 * @returns A display string built from the available `city, region, country` parts
 *   (e.g. `"San Francisco, CA, US"` or just `"US"`), or `null` when the IP is missing,
 *   private/loopback (RFC 1918 / localhost), malformed, or not present in the database.
 *
 * @remarks
 * - **Algorithm:** a single in-memory `geoip.lookup` (the database is loaded once at module
 *   eval time); the non-empty `city` / `region` / `country` fields are joined with `", "`.
 * - **Failure modes:** never throws — any lookup error or unknown IP degrades to `null`, so a
 *   location lookup can never break the endpoint that calls it (e.g. "list my sessions").
 * - **Side effects:** none at call time (the database load is a one-time module-init cost).
 * - **Notes:** the bundled GeoLite data is approximate and only city-level at best; the free
 *   tier frequently resolves only the country. It ships with the package (no network call,
 *   no API key) but ages over time — refresh it periodically via `geoip-lite`'s `updatedb`.
 */
export function resolveSessionLocation(ipAddress: string | null | undefined): string | null {
  if (!ipAddress) {
    return null;
  }
  try {
    const geo = geoip.lookup(ipAddress);
    if (!geo) {
      return null;
    }
    const parts = [geo.city, geo.region, geo.country]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(', ') : null;
  } catch {
    // A geo lookup is a display nicety; never let it surface as a request failure.
    return null;
  }
}
