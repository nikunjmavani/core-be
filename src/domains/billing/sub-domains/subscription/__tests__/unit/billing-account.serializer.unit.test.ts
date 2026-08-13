import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { BillingAccountSerializer } from '@/domains/billing/sub-domains/subscription/billing-account.serializer.js';

/**
 * This serializer is the boundary between Stripe's object graph and our public response body. Two
 * classes of bug live here and neither was covered: money arithmetic (Stripe sends integer cents;
 * the wire format is a fixed-2 decimal string) and over-exposure (a Stripe object carries far more
 * fields than we intend to publish — customer ids, PaymentMethod fingerprints, raw metadata).
 */
describe('billing-account.serializer', () => {
  function buildInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
    return {
      id: 'in_123',
      number: 'INV-0001',
      status: 'paid',
      amount_due: 2500,
      amount_paid: 2500,
      currency: 'usd',
      created: 1_700_000_000,
      due_date: 1_700_086_400,
      hosted_invoice_url: 'https://invoice.example/in_123',
      invoice_pdf: 'https://invoice.example/in_123.pdf',
      ...overrides,
    } as unknown as Stripe.Invoice;
  }

  function buildPaymentMethod(overrides: Record<string, unknown> = {}): Stripe.PaymentMethod {
    return {
      id: 'pm_123',
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
      ...overrides,
    } as unknown as Stripe.PaymentMethod;
  }

  describe('invoice — money conversion', () => {
    it.each([
      [2500, '25.00'],
      [0, '0.00'],
      [1, '0.01'],
      [99, '0.99'],
      [100, '1.00'],
      [123_456, '1234.56'],
    ])('renders %i cents as "%s"', (cents, expected) => {
      const result = BillingAccountSerializer.invoice(
        buildInvoice({ amount_due: cents, amount_paid: cents }),
      );

      expect(result.amount_due).toBe(expected);
      expect(result.amount_paid).toBe(expected);
    });

    it('always emits two decimal places as a string, never a number', () => {
      const result = BillingAccountSerializer.invoice(buildInvoice({ amount_due: 500 }));

      expect(typeof result.amount_due).toBe('string');
      expect(result.amount_due).toBe('5.00');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('renders a %s amount as "0.00" rather than NaN', (_label, cents) => {
      const result = BillingAccountSerializer.invoice(
        buildInvoice({ amount_due: cents as unknown as number }),
      );

      expect(result.amount_due).toBe('0.00');
    });

    it('handles a negative amount (credit note) without losing the sign', () => {
      const result = BillingAccountSerializer.invoice(buildInvoice({ amount_due: -2500 }));

      expect(result.amount_due).toBe('-25.00');
    });
  });

  describe('invoice — timestamps', () => {
    it('converts Stripe epoch SECONDS to an ISO-8601 string', () => {
      const result = BillingAccountSerializer.invoice(buildInvoice({ created: 1_700_000_000 }));

      // Seconds, not milliseconds — a missing ×1000 lands in 1970.
      expect(result.created_at).toBe(new Date(1_700_000_000 * 1000).toISOString());
      expect(result.created_at.startsWith('2023-')).toBe(true);
    });

    it('falls back to the epoch when created is absent, never to an invalid date', () => {
      const result = BillingAccountSerializer.invoice(
        buildInvoice({ created: null as unknown as number }),
      );

      expect(result.created_at).toBe(new Date(0).toISOString());
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('emits a %s due_date as null (it is genuinely optional)', (_label, dueDate) => {
      const result = BillingAccountSerializer.invoice(
        buildInvoice({ due_date: dueDate as unknown as number }),
      );

      expect(result.due_date).toBeNull();
    });
  });

  describe('invoice — field shape and leak prevention', () => {
    it('emits exactly the documented snake_case key set', () => {
      const result = BillingAccountSerializer.invoice(buildInvoice());

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
    });

    it('does not leak Stripe-internal fields present on the source object', () => {
      const result = BillingAccountSerializer.invoice(
        buildInvoice({
          customer: 'cus_secret',
          subscription: 'sub_secret',
          metadata: { internal: 'do-not-publish' },
        } as unknown as Partial<Stripe.Invoice>),
      );

      expect(result).not.toHaveProperty('customer');
      expect(result).not.toHaveProperty('subscription');
      expect(result).not.toHaveProperty('metadata');
    });

    it('defaults a missing status to "draft" rather than emitting undefined', () => {
      const result = BillingAccountSerializer.invoice(
        buildInvoice({ status: null as unknown as Stripe.Invoice.Status }),
      );

      expect(result.status).toBe('draft');
    });

    it('emits a missing invoice number as null', () => {
      const result = BillingAccountSerializer.invoice(
        buildInvoice({ number: null as unknown as string }),
      );

      expect(result.invoice_number).toBeNull();
    });

    it.each([
      ['hosted_invoice_url', 'hosted_invoice_url'],
      ['invoice_pdf', 'invoice_pdf'],
    ])('emits a missing %s as null', (field) => {
      const result = BillingAccountSerializer.invoice(
        buildInvoice({ [field]: null } as unknown as Partial<Stripe.Invoice>),
      );

      expect(result[field as 'hosted_invoice_url' | 'invoice_pdf']).toBeNull();
    });
  });

  describe('invoices — list', () => {
    it('maps every row through the single-invoice serializer', () => {
      const rows = [buildInvoice({ id: 'in_1' }), buildInvoice({ id: 'in_2' })];

      const result = BillingAccountSerializer.invoices(rows);

      expect(result.map((invoice) => invoice.id)).toEqual(['in_1', 'in_2']);
      expect(result[0]).toEqual(BillingAccountSerializer.invoice(rows[0] as Stripe.Invoice));
    });

    it('returns an empty array for no rows', () => {
      expect(BillingAccountSerializer.invoices([])).toEqual([]);
    });
  });

  describe('paymentMethod', () => {
    it('serializes card details and the is_default flag', () => {
      const result = BillingAccountSerializer.paymentMethod(buildPaymentMethod(), true);

      expect(result).toEqual({
        id: 'pm_123',
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2030,
        is_default: true,
      });
    });

    it('falls back safely when the payment method carries no card object', () => {
      const result = BillingAccountSerializer.paymentMethod(
        buildPaymentMethod({ card: undefined }),
        false,
      );

      expect(result).toMatchObject({ brand: 'card', last4: '????', exp_month: 0, exp_year: 0 });
    });

    it('never emits the card fingerprint or other Stripe-internal card fields', () => {
      const result = BillingAccountSerializer.paymentMethod(
        buildPaymentMethod({
          card: {
            brand: 'visa',
            last4: '4242',
            exp_month: 12,
            exp_year: 2030,
            fingerprint: 'fp_secret',
            country: 'US',
          },
          customer: 'cus_secret',
        }),
        false,
      );

      expect(result).not.toHaveProperty('fingerprint');
      expect(result).not.toHaveProperty('country');
      expect(result).not.toHaveProperty('customer');
      expect(Object.keys(result).sort()).toEqual(
        ['brand', 'exp_month', 'exp_year', 'id', 'is_default', 'last4'].sort(),
      );
    });
  });

  describe('paymentMethods — default resolution', () => {
    it('marks only the matching id as default', () => {
      const rows = [buildPaymentMethod({ id: 'pm_1' }), buildPaymentMethod({ id: 'pm_2' })];

      const result = BillingAccountSerializer.paymentMethods(rows, 'pm_2');

      expect(result.map((method) => method.is_default)).toEqual([false, true]);
    });

    it('marks nothing as default when there is no default payment method', () => {
      const rows = [buildPaymentMethod({ id: 'pm_1' }), buildPaymentMethod({ id: 'pm_2' })];

      const result = BillingAccountSerializer.paymentMethods(rows, null);

      expect(result.every((method) => method.is_default === false)).toBe(true);
    });

    it('marks nothing as default when the default id matches no row', () => {
      const rows = [buildPaymentMethod({ id: 'pm_1' })];

      const result = BillingAccountSerializer.paymentMethods(rows, 'pm_absent');

      expect(result[0]?.is_default).toBe(false);
    });

    it('returns an empty array for no rows', () => {
      expect(BillingAccountSerializer.paymentMethods([], 'pm_1')).toEqual([]);
    });
  });
});
