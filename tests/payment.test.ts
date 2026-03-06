import { describe, test, expect } from 'vitest';
import {
  isTrialActive, trialDaysRemaining, resolveProStatus, statusLabel,
  maxHistory, maxEnvironments, collectionsEnabled,
  FREE_MAX_HISTORY, FREE_MAX_ENVIRONMENTS, TRIAL_DAYS,
} from '../utils/payment';

describe('isTrialActive', () => {
  test('returns false when trialStartedAt is null', () => {
    expect(isTrialActive(null)).toBe(false);
  });

  test('returns true when trial just started', () => {
    expect(isTrialActive(new Date())).toBe(true);
  });

  test('returns true on day 6 of 7-day trial', () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    expect(isTrialActive(sixDaysAgo, 7)).toBe(true);
  });

  test('returns false when trial expired', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(isTrialActive(eightDaysAgo, 7)).toBe(false);
  });

  test('returns false exactly at expiry', () => {
    const exactlySevenDays = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(isTrialActive(exactlySevenDays, 7)).toBe(false);
  });
});

describe('trialDaysRemaining', () => {
  test('returns 0 when null', () => {
    expect(trialDaysRemaining(null)).toBe(0);
  });

  test('returns full days when just started', () => {
    expect(trialDaysRemaining(new Date(), 7)).toBe(7);
  });

  test('returns 0 when expired', () => {
    const expired = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    expect(trialDaysRemaining(expired, 7)).toBe(0);
  });

  test('rounds up partial days', () => {
    const fiveDaysOneHourAgo = new Date(Date.now() - (5 * 24 + 1) * 60 * 60 * 1000);
    expect(trialDaysRemaining(fiveDaysOneHourAgo, 7)).toBe(2);
  });
});

describe('resolveProStatus', () => {
  test('unlocked when paid', () => {
    const status = resolveProStatus({ paid: true, paidAt: new Date(), trialStartedAt: null });
    expect(status.unlocked).toBe(true);
    expect(status.paid).toBe(true);
  });

  test('unlocked during active trial', () => {
    const status = resolveProStatus({ paid: false, paidAt: null, trialStartedAt: new Date() });
    expect(status.unlocked).toBe(true);
    expect(status.trialActive).toBe(true);
  });

  test('locked when not paid and no trial', () => {
    const status = resolveProStatus({ paid: false, paidAt: null, trialStartedAt: null });
    expect(status.unlocked).toBe(false);
  });

  test('locked when trial expired', () => {
    const status = resolveProStatus({
      paid: false, paidAt: null,
      trialStartedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    expect(status.unlocked).toBe(false);
  });
});

describe('statusLabel', () => {
  test('Pro when paid', () => {
    expect(statusLabel({ unlocked: true, paid: true, paidAt: new Date(), trialActive: false, trialDaysLeft: 0 })).toBe('Pro');
  });

  test('Trial with days', () => {
    expect(statusLabel({ unlocked: true, paid: false, paidAt: null, trialActive: true, trialDaysLeft: 3 })).toBe('Trial (3d left)');
  });

  test('Free when locked', () => {
    expect(statusLabel({ unlocked: false, paid: false, paidAt: null, trialActive: false, trialDaysLeft: 0 })).toBe('Free');
  });
});

describe('tier limits', () => {
  test('free history limit', () => {
    expect(maxHistory(false)).toBe(FREE_MAX_HISTORY);
  });

  test('pro history unlimited', () => {
    expect(maxHistory(true)).toBe(Infinity);
  });

  test('free environment limit', () => {
    expect(maxEnvironments(false)).toBe(FREE_MAX_ENVIRONMENTS);
  });

  test('pro environments unlimited', () => {
    expect(maxEnvironments(true)).toBe(Infinity);
  });

  test('free collections disabled', () => {
    expect(collectionsEnabled(false)).toBe(false);
  });

  test('pro collections enabled', () => {
    expect(collectionsEnabled(true)).toBe(true);
  });
});
