import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { BillingAccountSerializer } from '@/domains/billing/sub-domains/subscription/billing-account.serializer.js';

/**
 * Billing account wire shapes — invoices and payment methods proxied from Stripe.
 *
 * @remarks
 * This serializer formats **money** for display, and it had no test. Amounts arrive from Stripe as
 * integer cents and leave as decimal strings; a rounding or scaling slip here shows a customer the
 * wrong number on their invoice list, and nothing else in the stack would catch it because the
 * value is correct right up until this function.
 *
 * The card branch matters for a different reason: Stripe omits `card` entirely on non-card payment
 * methods, so every field is optional. The fallbacks exist so a bank-debit method renders as
 * something inert rather than crashing the billing page or printing `undefined`.
 */
function invoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: 'in_abc123',
    number: 'INV-0001',
    status: 'paid',
    amount_due: 2000,
    amount_paid: 2000,
    currency: 'usd',
    created: 1_777_000_000,
    due_date: null,
    hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
    invoice_pdf: 'https://invoice.stripe.com/i/abc.pdf',
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function paymentMethod(overrides: Record<string, unknown> = {}): Stripe.PaymentMethod {
  return {
    id: 'pm_abc123',
    type: 'card',
    card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
    ...overrides,
  } as unknown as Stripe.PaymentMethod;
}

describe('BillingAccountSerializer.invoice', () => {
  it('maps the documented wire shape', () => {
    expect(BillingAccountSerializer.invoice(invoice())).toEqual({
      id: 'in_abc123',
      invoice_number: 'INV-0001',
      status: 'paid',
      amount_due: '20.00',
      amount_paid: '20.00',
      currency: 'usd',
      created_at: new Date(1_777_000_000 * 1000).toISOString(),
      due_date: null,
      hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
      invoice_pdf: 'https://invoice.stripe.com/i/abc.pdf',
    });
  });

  describe('money formatting', () => {
    it.each([
      ['a whole amount', 2000, '20.00'],
      ['cents that need both decimal places', 1999, '19.99'],
      ['a single trailing cent', 2001, '20.01'],
      ['zero', 0, '0.00'],
      ['a sub-dollar amount', 5, '0.05'],
      ['a single cent', 1, '0.01'],
      ['a large amount', 123_456_789, '1234567.89'],
      ['a negative amount (credit)', -500, '-5.00'],
    ])('formats %s', (_label, cents, expected) => {
      expect(BillingAccountSerializer.invoice(invoice({ amount_due: cents })).amount_due).toBe(
        expected,
      );
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('renders %s as 0.00 rather than NaN', (_label, cents) => {
      // Without the guard this becomes `NaN` — which serialises into the response body as the
      // string "NaN" and renders as a broken amount on the billing page.
      const serialized = BillingAccountSerializer.invoice(
        invoice({ amount_due: cents as unknown as number }),
      );

      expect(serialized.amount_due).toBe('0.00');
    });

    it('always emits exactly two decimal places', () => {
      for (const cents of [0, 1, 10, 100, 1000, 99_999]) {
        expect(BillingAccountSerializer.invoice(invoice({ amount_due: cents })).amount_due).toMatch(
          /^-?\d+\.\d{2}$/,
        );
      }
    });

    it('formats amount_due and amount_paid independently', () => {
      // A partially paid invoice; collapsing the two would misreport what is still owed.
      const serialized = BillingAccountSerializer.invoice(
        invoice({ amount_due: 5000, amount_paid: 1500 }),
      );

      expect(serialized.amount_due).toBe('50.00');
      expect(serialized.amount_paid).toBe('15.00');
    });
  });

  describe('timestamps', () => {
    it('converts epoch seconds to an ISO string', () => {
      // Stripe sends seconds; JavaScript expects milliseconds. Forgetting the ×1000 dates every
      // invoice to 1970.
      expect(BillingAccountSerializer.invoice(invoice({ created: 1_777_000_000 })).created_at).toBe(
        new Date(1_777_000_000_000).toISOString(),
      );
    });

    it('renders a null due_date as null', () => {
      expect(BillingAccountSerializer.invoice(invoice({ due_date: null })).due_date).toBeNull();
    });

    it('converts a present due_date', () => {
      expect(BillingAccountSerializer.invoice(invoice({ due_date: 1_777_100_000 })).due_date).toBe(
        new Date(1_777_100_000_000).toISOString(),
      );
    });

    it('falls back to the epoch when created is missing', () => {
      // created_at is non-nullable on the wire, so it needs a value; the epoch is an obvious
      // sentinel rather than a plausible-looking recent date.
      const serialized = BillingAccountSerializer.invoice(
        invoice({ created: null as unknown as number }),
      );

      expect(serialized.created_at).toBe(new Date(0).toISOString());
    });
  });

  describe('optional fields', () => {
    it('renders a missing invoice number as null', () => {
      expect(BillingAccountSerializer.invoice(invoice({ number: null })).invoice_number).toBeNull();
    });

    it('defaults a missing status to draft', () => {
      expect(BillingAccountSerializer.invoice(invoice({ status: null })).status).toBe('draft');
    });

    it('renders missing hosted urls as null rather than undefined', () => {
      // These are optional on the wire; undefined would be dropped by JSON serialisation and the
      // key would vanish from the response, breaking clients that read it unconditionally.
      const serialized = BillingAccountSerializer.invoice(
        invoice({ hosted_invoice_url: null, invoice_pdf: null }),
      );

      expect(serialized.hosted_invoice_url).toBeNull();
      expect(serialized.invoice_pdf).toBeNull();
    });
  });

  it('exposes no Stripe fields beyond the documented set', () => {
    // The invoice object carries customer ids, line items and internal metadata. The wire shape is
    // an allow-list, and this asserts it stays one.
    const serialized = BillingAccountSerializer.invoice(
      invoice({ customer: 'cus_secret', metadata: { internal: 'do-not-leak' } } as never),
    );

    expect(Object.keys(serialized).sort()).toEqual([
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
    ]);
  });
});

describe('BillingAccountSerializer.invoices', () => {
  it('maps every row', () => {
    const rows = [invoice({ id: 'in_1' }), invoice({ id: 'in_2' })];

    expect(BillingAccountSerializer.invoices(rows).map((entry) => entry.id)).toEqual([
      'in_1',
      'in_2',
    ]);
  });

  it('returns an empty array for no invoices', () => {
    expect(BillingAccountSerializer.invoices([])).toEqual([]);
  });
});

describe('BillingAccountSerializer.paymentMethod', () => {
  it('maps a card', () => {
    expect(BillingAccountSerializer.paymentMethod(paymentMethod(), false)).toEqual({
      id: 'pm_abc123',
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2030,
      is_default: false,
    });
  });

  it('falls back to inert values when the method carries no card', () => {
    // Stripe omits `card` on bank debits and wallets. Without these fallbacks the billing page
    // renders `undefined` for the brand and last4.
    expect(
      BillingAccountSerializer.paymentMethod(paymentMethod({ card: undefined }), false),
    ).toMatchObject({
      brand: 'card',
      last4: '????',
      exp_month: 0,
      exp_year: 0,
    });
  });

  it('reflects the is_default flag it is given', () => {
    expect(BillingAccountSerializer.paymentMethod(paymentMethod(), true).is_default).toBe(true);
  });

  it('exposes no fields beyond the documented set', () => {
    const serialized = BillingAccountSerializer.paymentMethod(
      paymentMethod({ billing_details: { email: 'private@example.com' } }),
      false,
    );

    expect(Object.keys(serialized).sort()).toEqual([
      'brand',
      'exp_month',
      'exp_year',
      'id',
      'is_default',
      'last4',
    ]);
  });
});

describe('BillingAccountSerializer.paymentMethods', () => {
  it('marks exactly the default method', () => {
    const rows = [paymentMethod({ id: 'pm_1' }), paymentMethod({ id: 'pm_2' })];

    const serialized = BillingAccountSerializer.paymentMethods(rows, 'pm_2');

    expect(serialized.map((entry) => entry.is_default)).toEqual([false, true]);
  });

  it('marks nothing as default when no default is set', () => {
    // The null case has to be explicit: a loose comparison would make `undefined === null` true
    // for a method whose id failed to load, flagging the wrong card as default.
    const rows = [paymentMethod({ id: 'pm_1' }), paymentMethod({ id: 'pm_2' })];

    const serialized = BillingAccountSerializer.paymentMethods(rows, null);

    expect(serialized.every((entry) => entry.is_default === false)).toBe(true);
  });

  it('marks nothing when the default id matches no listed method', () => {
    const serialized = BillingAccountSerializer.paymentMethods(
      [paymentMethod({ id: 'pm_1' })],
      'pm_detached',
    );

    expect(serialized[0]?.is_default).toBe(false);
  });

  it('returns an empty array for no methods', () => {
    expect(BillingAccountSerializer.paymentMethods([], null)).toEqual([]);
  });
});
