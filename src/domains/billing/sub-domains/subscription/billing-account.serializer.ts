import type Stripe from "stripe";

function moneyFromCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "0.00";
  return (cents / 100).toFixed(2);
}

function toIsoSeconds(epochSeconds: number | null | undefined): string | null {
  if (epochSeconds === null || epochSeconds === undefined) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Public wire shapes for Stripe-proxied billing account resources (invoices, payment methods).
 * Provider object ids (`in_*`, `pm_*`) are exposed because there is no local invoice/PM table —
 * clients need them only for display keys and opening hosted invoice URLs returned inline.
 */
export const BillingAccountSerializer = {
  invoice(row: Stripe.Invoice) {
    return {
      id: row.id,
      invoice_number: row.number ?? null,
      status: row.status ?? "draft",
      amount_due: moneyFromCents(row.amount_due),
      amount_paid: moneyFromCents(row.amount_paid),
      currency: row.currency,
      created_at: toIsoSeconds(row.created) ?? new Date(0).toISOString(),
      due_date: toIsoSeconds(row.due_date),
      hosted_invoice_url: row.hosted_invoice_url ?? null,
      invoice_pdf: row.invoice_pdf ?? null,
    };
  },
  invoices(rows: readonly Stripe.Invoice[]) {
    return rows.map((row) => BillingAccountSerializer.invoice(row));
  },
  paymentMethod(row: Stripe.PaymentMethod, isDefault: boolean) {
    const card = row.card;
    return {
      id: row.id,
      brand: card?.brand ?? "card",
      last4: card?.last4 ?? "????",
      exp_month: card?.exp_month ?? 0,
      exp_year: card?.exp_year ?? 0,
      is_default: isDefault,
    };
  },
  paymentMethods(
    rows: readonly Stripe.PaymentMethod[],
    defaultPaymentMethodId: string | null,
  ) {
    return rows.map((row) =>
      BillingAccountSerializer.paymentMethod(
        row,
        defaultPaymentMethodId !== null && row.id === defaultPaymentMethodId,
      ),
    );
  },
};
