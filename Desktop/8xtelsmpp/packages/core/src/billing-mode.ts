// ── Per-rate billing modes (WHEN the client is charged) ───────────────────────
// Separate from route/vendor/MCC/MNC/currency/rate/DLR status: the mode picks
// the billing EVENT that creates the billable usage for one message.
// Stored per rate row (rate_notification_rates.billing_mode,
// client_saved_rates.billing_mode) and stamped onto messages at routing time
// (messages.billing_mode) so the billing engine bills accordingly.

export const BILLING_MODES = [
  'on_submission',
  'on_delivery',
  'submission_delivery',
  'operator_submission',
  'operator_delivery',
  'hybrid',
  'on_attempt',
  'on_accepted',
] as const;

export type BillingMode = (typeof BILLING_MODES)[number];

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  on_submission: 'On Submission',
  on_delivery: 'On Delivery Only',
  submission_delivery: 'Submission + Delivery',
  operator_submission: 'Operator Submission',
  operator_delivery: 'Operator Delivery',
  hybrid: 'Hybrid: Submission + Operator Delivery',
  on_attempt: 'On Attempt',
  on_accepted: 'On Accepted',
};

export const BILLING_MODE_EVENTS: Record<BillingMode, string> = {
  on_submission: 'SUBMITTED',
  on_delivery: 'DELIVERED',
  submission_delivery: 'SUBMITTED+DELIVERED',
  operator_submission: 'OPERATOR_SUBMITTED',
  operator_delivery: 'OPERATOR_DELIVERED',
  hybrid: 'OPERATOR_SUBMITTED+OPERATOR_DELIVERED',
  on_attempt: 'ROUTE_ATTEMPT',
  on_accepted: 'ACCEPTED',
};

export function isBillingMode(v: unknown): v is BillingMode {
  return typeof v === 'string' && (BILLING_MODES as readonly string[]).includes(v);
}

export function billingModeLabel(v: unknown): string {
  return isBillingMode(v) ? BILLING_MODE_LABELS[v] : 'On Submission';
}

/** Modes whose charge happens (at least partly) at submit time. */
const SUBMIT_BILLED: ReadonlySet<BillingMode> = new Set([
  'on_submission', 'submission_delivery', 'operator_submission', 'hybrid', 'on_attempt', 'on_accepted',
]);

/** Modes whose charge happens (at least partly) on a delivered DLR. */
const DELIVERY_BILLED: ReadonlySet<BillingMode> = new Set([
  'on_delivery', 'submission_delivery', 'operator_delivery', 'hybrid',
]);

export function billsOnSubmit(mode: BillingMode): boolean {
  return SUBMIT_BILLED.has(mode);
}

export function billsOnDelivery(mode: BillingMode): boolean {
  return DELIVERY_BILLED.has(mode);
}
