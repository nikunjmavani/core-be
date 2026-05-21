/** Stripe API uses application/x-www-form-urlencoded for writes. Keys use bracket nesting (e.g. metadata[k]). */

export type StripeEncodedFlatForm = Record<string, string>;

function normalizeQueryStringParsedFieldValue(fieldValue: unknown): string | undefined {
  if (typeof fieldValue === 'string') {
    return fieldValue;
  }
  if (Array.isArray(fieldValue) && fieldValue.length > 0 && typeof fieldValue[0] === 'string') {
    return fieldValue[0];
  }
  return undefined;
}

export function decodeStripeEncodedForm(body: unknown): StripeEncodedFlatForm {
  /**
   * Nock pre-parses `application/x-www-form-urlencoded` bodies via `querystring.parse`
   * before invoking function matchers (see `nock/lib/match_body.js`).
   */
  if (body !== null && typeof body === 'object') {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
      return Object.fromEntries(new URLSearchParams(body.toString('utf8')));
    }
    if (body instanceof Uint8Array) {
      return Object.fromEntries(new URLSearchParams(Buffer.from(body).toString('utf8')));
    }
    if (!Array.isArray(body)) {
      const parsedQueryFields = body as Record<string, unknown>;
      const decodedFromQueryStringParse: StripeEncodedFlatForm = {};
      for (const [fieldKey, fieldValue] of Object.entries(parsedQueryFields)) {
        const normalized = normalizeQueryStringParsedFieldValue(fieldValue);
        if (normalized !== undefined) {
          decodedFromQueryStringParse[fieldKey] = normalized;
        }
      }
      return decodedFromQueryStringParse;
    }
  }
  if (typeof body === 'string') {
    return Object.fromEntries(new URLSearchParams(body));
  }
  return {};
}

/** Assert every expected key resolves to exactly the fixture value after decoding. */
export function assertStripeEncodedFormContainsExpectedFields(parameters: {
  stripeOutboundRequestBody: unknown;
  expectedStripeFields: StripeEncodedFlatForm;
}): void {
  const decoded = decodeStripeEncodedForm(parameters.stripeOutboundRequestBody);
  for (const [fieldKey, expectedValue] of Object.entries(parameters.expectedStripeFields)) {
    if (decoded[fieldKey] !== expectedValue) {
      throw new Error(
        `Stripe form field mismatch on ${fieldKey}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(decoded[fieldKey])}`,
      );
    }
  }
}
