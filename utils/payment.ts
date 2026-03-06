/**
 * Payment/licensing utilities for Browser API Client.
 * Pure functions for pro status resolution — no ExtPay dependency.
 * ExtPay initialization lives in background.ts and popup code.
 */

/** ExtensionPay extension ID. Replace after registering at extensionpay.com */
export const EXTPAY_ID = 'browser-api-client';

/** Pricing: $49/yr or $5/mo subscription */
export const PRICE_YEARLY = '$49/yr';
export const PRICE_MONTHLY = '$5/mo';

/** Trial duration in days */
export const TRIAL_DAYS = 7;

/** Free tier limits */
export const FREE_MAX_HISTORY = 50;
export const FREE_MAX_ENVIRONMENTS = 1;
export const FREE_COLLECTIONS = false;

export interface ProStatus {
  unlocked: boolean;
  paid: boolean;
  paidAt: Date | null;
  trialActive: boolean;
  trialDaysLeft: number;
}

/** Minimal user shape from ExtPay's getUser() — only fields we use */
export interface PaymentUser {
  paid: boolean;
  paidAt: Date | null;
  trialStartedAt: Date | null;
}

/** Check if a trial is still active given its start date and duration */
export function isTrialActive(trialStartedAt: Date | null, trialDays: number = TRIAL_DAYS): boolean {
  if (!trialStartedAt) return false;
  const elapsed = Date.now() - trialStartedAt.getTime();
  return elapsed < trialDays * 24 * 60 * 60 * 1000;
}

/** Days remaining in trial (0 if expired or not started) */
export function trialDaysRemaining(trialStartedAt: Date | null, trialDays: number = TRIAL_DAYS): number {
  if (!trialStartedAt) return 0;
  const elapsed = Date.now() - trialStartedAt.getTime();
  const remaining = trialDays - elapsed / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(remaining));
}

/** Resolve full pro status from ExtPay user data */
export function resolveProStatus(user: PaymentUser, trialDays: number = TRIAL_DAYS): ProStatus {
  const trialActive = isTrialActive(user.trialStartedAt, trialDays);
  return {
    unlocked: user.paid || trialActive,
    paid: user.paid,
    paidAt: user.paidAt,
    trialActive,
    trialDaysLeft: trialDaysRemaining(user.trialStartedAt, trialDays),
  };
}

/** Format status for display */
export function statusLabel(status: ProStatus): string {
  if (status.paid) return 'Pro';
  if (status.trialActive) return `Trial (${status.trialDaysLeft}d left)`;
  return 'Free';
}

/** Get effective history limit based on pro status */
export function maxHistory(unlocked: boolean): number {
  return unlocked ? Infinity : FREE_MAX_HISTORY;
}

/** Get effective environment limit based on pro status */
export function maxEnvironments(unlocked: boolean): number {
  return unlocked ? Infinity : FREE_MAX_ENVIRONMENTS;
}

/** Check if collections feature is available */
export function collectionsEnabled(unlocked: boolean): boolean {
  return unlocked || FREE_COLLECTIONS;
}
