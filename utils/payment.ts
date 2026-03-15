/**
 * Payment/licensing utilities for Browser API Client.
 * Core pro-status logic comes from @brightbar-dev/wxt-extpay.
 * BAC-specific constants and tier limit functions live here.
 */

// Re-export core types and functions from the shared module
export {
  isTrialActive,
  trialDaysRemaining,
  resolveProStatus,
  statusLabel,
  type PaymentUser,
  type ProStatus,
} from '@brightbar-dev/wxt-extpay/pro-status';

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
