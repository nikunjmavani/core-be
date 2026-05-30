/** Maps the five HTML-significant characters to their entity references. */
const HTML_ENTITY_BY_CHARACTER: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const HTML_SIGNIFICANT_CHARACTER_PATTERN = /[&<>"']/g;

/**
 * Escapes the five HTML-significant characters (`& < > " '`) in a string so
 * user- or tenant-controlled values can be safely interpolated into email HTML.
 *
 * @remarks
 * - **Algorithm:** single regex pass replacing each significant character with
 *   its entity reference; `&` is handled by the same map so output is not
 *   double-escaped within one call.
 * - **Failure modes:** none — non-string inputs are impossible at the type
 *   level; an empty string returns an empty string.
 * - **Side effects:** none (pure function).
 * - **Notes:** intended for HTML text/attribute contexts. Do not use to encode
 *   values placed inside `<script>`, `<style>`, or URL contexts — those need
 *   context-specific encoding. Call once at the point untrusted data enters a
 *   template to avoid double-escaping.
 */
export function escapeHtml(value: string): string {
  return value.replace(
    HTML_SIGNIFICANT_CHARACTER_PATTERN,
    (character) => HTML_ENTITY_BY_CHARACTER[character] ?? character,
  );
}
