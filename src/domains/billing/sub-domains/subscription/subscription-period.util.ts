/**
 * Advances a date by a whole number of months, clamping the day to the last valid day of the
 * target month so month-end start dates never overflow into the following month (e.g. Jan 31 + 1
 * month yields Feb 28/29, not Mar 3). Used to derive a subscription's local `current_period_end`
 * from its start date and billing cycle; for Stripe-backed subscriptions the authoritative period
 * end arrives via webhook and overwrites this value.
 */
export function addMonths(base: Date, months: number): Date {
  const result = new Date(base);
  const dayOfMonth = result.getDate();
  // Shift the month from the 1st so the intermediate date can never overflow, then clamp the day.
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
  return result;
}
