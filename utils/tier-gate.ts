/**
 * Tier gating — pure functions for checking limits and building upsell context.
 * No DOM or browser API dependency; all side effects live in popup/background.
 */

import type { ProStatus } from './payment';
import {
  maxHistory, maxEnvironments, collectionsEnabled,
  FREE_MAX_HISTORY, FREE_MAX_ENVIRONMENTS,
  PRICE_YEARLY, PRICE_MONTHLY,
} from './payment';

export type GatedFeature = 'history' | 'environments' | 'collections';

export interface LimitCheck {
  allowed: boolean;
  current: number;
  max: number;
  feature: GatedFeature;
}

export interface UpsellContext {
  feature: GatedFeature;
  message: string;
  ctaLabel: string;
  /** 'payment' to open payment page, 'trial' to start trial */
  ctaAction: 'payment' | 'trial';
}

/** Check if adding one more history entry would exceed the limit. */
export function checkHistoryLimit(currentCount: number, unlocked: boolean): LimitCheck {
  const max = maxHistory(unlocked);
  return {
    allowed: currentCount < max,
    current: currentCount,
    max,
    feature: 'history',
  };
}

/** Check if adding one more environment would exceed the limit. */
export function checkEnvironmentLimit(currentCount: number, unlocked: boolean): LimitCheck {
  const max = maxEnvironments(unlocked);
  return {
    allowed: currentCount < max,
    current: currentCount,
    max,
    feature: 'environments',
  };
}

/** Check if collections feature is available. */
export function checkCollectionsAccess(unlocked: boolean): LimitCheck {
  return {
    allowed: collectionsEnabled(unlocked),
    current: 0,
    max: collectionsEnabled(unlocked) ? Infinity : 0,
    feature: 'collections',
  };
}

/** Build an upsell message for a gated feature. */
export function buildUpsell(feature: GatedFeature, status: ProStatus): UpsellContext {
  const canTrial = !status.paid && !status.trialActive && status.trialDaysLeft === 0;

  const messages: Record<GatedFeature, string> = {
    history: `Free plan is limited to ${FREE_MAX_HISTORY} history entries. Upgrade to Pro for unlimited history.`,
    environments: `Free plan includes ${FREE_MAX_ENVIRONMENTS} environment. Upgrade to Pro for unlimited environments.`,
    collections: 'Collections are a Pro feature. Upgrade to organize requests into named groups.',
  };

  return {
    feature,
    message: messages[feature],
    ctaLabel: canTrial ? 'Start Free Trial' : `Upgrade (${PRICE_YEARLY})`,
    ctaAction: canTrial ? 'trial' : 'payment',
  };
}

/** Build a short inline upsell string (for compact UI spots). */
export function inlineUpsellText(feature: GatedFeature): string {
  switch (feature) {
    case 'history':
      return `Limit: ${FREE_MAX_HISTORY} entries`;
    case 'environments':
      return `Limit: ${FREE_MAX_ENVIRONMENTS} environment`;
    case 'collections':
      return 'Pro feature';
  }
}
