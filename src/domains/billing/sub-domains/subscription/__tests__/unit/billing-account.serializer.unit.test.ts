import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { BillingAccountSerializer } from '@/domains/billing/sub-domains/subscription/billing-account.serializer.js';

/**
 * `subscription.serializer` has two test files; the billing-account serializer had none — even
 * though it is the only thing standing between a raw Stripe `Invoice` / `PaymentMethod` object
 * and the wire. Stripe objects carry far more than the public shape (customer ids, payment
 * intents, `billing_details` PII, full card fingerprints), so the projections below are an
 * allowlist and are asserted as such.
 */
function makeInvoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: 'in_1234567890',
    number: 'CORE-0001',
    status: 'paid',
    amount_due: 4999,
    amount_paid: 4999,
    currency: 'usd',
    created: 1_767_225_600,
    due_date: 1_769_904_000,
    hosted_invoice_url: 'https://invoice.stripe.com/i/acct_x/test',
    invoice_pdf: 'https://invoice.stripe.com/i/acct_x/test.pdf',
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function makePaymentMethod(overrides: Record<string, unknown> = {}): Stripe.PaymentMethod {
  return {
    id: 'pm_1234567890',
    card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
    ...overrides,
  } as unknown as Stripe.PaymentMethod;
}

describe('billing-account.serializer', () => {
  describe('invoice', () => {
    it('emits the documented snake_case allowlist and nothing else', () => {
      const result = BillingAccountSerializer.invoice(makeInvoice());

      expect(Object.keys(result).sort()).toEqual(
        [
          'amount_due',
          'amount_paid',
          'created_at',
          'currency',
          'due_date',
          'hosted_invoice_url',
          'id',
          'invoice_number',
          'invoice_pdf',
          'status',
        ].sort(),
      );
      expect(Object.keys(result).every((key) => key === key.toLowerCase())).toBe(true);
      expect(Object.keys(result).some((key) => /[A-Z]/.test(key))).toBe(false);
    });

    it('drops Stripe-internal fields present on the source object', () => {
      const result = BillingAccountSerializer.invoice(
        makeInvoice({
          customer: 'cus_secret',
          payment_intent: 'pi_secret',
          subscription: 'sub_secret',
          customer_email: 'billing@example.com',
          account_country: 'US',
        }),
      );

      expect(result).not.toHaveProperty('customer');
      expect(result).not.toHaveProperty('payment_intent');
      expect(result).not.toHaveProperty('subscription');
      expect(result).not.toHaveProperty('customer_email');
      // `id` is the Stripe object id by design — there is no local invoice table, and clients
      // need it as a display key. It is a reference, not a secret.
      expect(result.id).toBe('in_1234567890');
    });

    it('renders cent amounts as fixed 2-decimal money strings', () => {
      const result = BillingAccountSerializer.invoice(
        makeInvoice({ amount_due: 4999, amount_paid: 0 }),
      );

      expect(result.amount_due).toBe('49.99');
      expect(result.amount_paid).toBe('0.00');
    });

    it('renders a null/undefined cent amount as "0.00" rather than "NaN"', () => {
      const result = BillingAccountSerializer.invoice(
        makeInvoice({ amount_due: null, amount_paid: undefined }),
      );

      expect(result.amount_due).toBe('0.00');
      expect(result.amount_paid).toBe('0.00');
    });

    it('converts Stripe epoch seconds to ISO-8601 timestamps', () => {
      const result = BillingAccountSerializer.invoice(
        makeInvoice({ created: 1_767_225_600, due_date: 1_769_904_000 }),
      );

      expect(result.created_at).toBe(new Date(1_767_225_600 * 1000).toISOString());
      expect(result.due_date).toBe(new Date(1_769_904_000 * 1000).toISOString());
    });

    it('keeps due_date nullable but always emits a created_at', () => {
      // A draft invoice has no due date. `created` is defensively floored to the epoch so the
      // response shape stays non-null for a field clients sort on.
      const result = BillingAccountSerializer.invoice(
        makeInvoice({ due_date: null, created: null }),
      );

      expect(result.due_date).toBeNull();
      expect(result.created_at).toBe(new Date(0).toISOString());
    });

    it('defaults a missing status to "draft" and a missing number to null', () => {
      const result = BillingAccountSerializer.invoice(makeInvoice({ status: null, number: null }));

      expect(result.status).toBe('draft');
      expect(result.invoice_number).toBeNull();
    });

    it('invoices() preserves order and applies the projection per row', () => {
      const result = BillingAccountSerializer.invoices([
        makeInvoice({ id: 'in_a', customer: 'cus_secret' }),
        makeInvoice({ id: 'in_b' }),
      ]);

      expect(result.map((entry) => entry.id)).toEqual(['in_a', 'in_b']);
      expect(result[0]).not.toHaveProperty('customer');
    });
  });

  describe('paymentMethod', () => {
    it('emits the documented snake_case allowlist and nothing else', () => {
      const result = BillingAccountSerializer.paymentMethod(makePaymentMethod(), false);

      expect(Object.keys(result).sort()).toEqual(
        ['brand', 'exp_month', 'exp_year', 'id', 'is_default', 'last4'].sort(),
      );
    });

    it('drops billing_details PII and the card fingerprint', () => {
      const result = BillingAccountSerializer.paymentMethod(
        makePaymentMethod({
          customer: 'cus_secret',
          billing_details: { email: 'card.holder@example.com', name: 'Card Holder' },
          card: {
            brand: 'visa',
            last4: '4242',
            exp_month: 12,
            exp_year: 2030,
            fingerprint: 'fp_secret',
            country: 'US',
          },
        }),
        false,
      );

      expect(result).not.toHaveProperty('billing_details');
      expect(result).not.toHaveProperty('customer');
      expect(result).not.toHaveProperty('fingerprint');
      expect(result).not.toHaveProperty('card');
      // last4 is the only card digit group ever exposed.
      expect(result.last4).toBe('4242');
    });

    it('falls back to safe placeholders for a non-card payment method', () => {
      const result = BillingAccountSerializer.paymentMethod(
        makePaymentMethod({ card: undefined }),
        false,
      );

      expect(result).toEqual({
        id: 'pm_1234567890',
        brand: 'card',
        last4: '????',
        exp_month: 0,
        exp_year: 0,
        is_default: false,
      });
    });

    it('paymentMethods() flags exactly the customer default', () => {
      const result = BillingAccountSerializer.paymentMethods(
        [makePaymentMethod({ id: 'pm_a' }), makePaymentMethod({ id: 'pm_b' })],
        'pm_b',
      );

      expect(result.map((entry) => [entry.id, entry.is_default])).toEqual([
        ['pm_a', false],
        ['pm_b', true],
      ]);
    });

    it('paymentMethods() flags nothing as default when the customer has none', () => {
      // Guards against a truthiness regression where `null === row.id` (both nullish-ish in a
      // loose comparison) would mark an unexpected card as the default.
      const result = BillingAccountSerializer.paymentMethods(
        [makePaymentMethod({ id: 'pm_a' }), makePaymentMethod({ id: 'pm_b' })],
        null,
      );

      expect(result.every((entry) => entry.is_default === false)).toBe(true);
    });
  });
});
