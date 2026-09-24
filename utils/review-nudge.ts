import { chromeWebStoreReviewUrl, mountReviewNudge, recordActivation, reviewNudgeCss, type MountOptions } from '@brightbar-dev/review-nudge';
import { browser } from 'wxt/browser';
import { t } from './i18n';

/**
 * The one-time review request. @brightbar-dev/review-nudge owns the rules (never on install, only
 * after 8 answered requests over 3 days, shown once, "Don't ask again" is final); this file says
 * which item it is for, where problems go, and when the app may show it at all.
 *
 * The Firefox build is not on the Chrome Web Store (or Firefox Add-ons), so it never asks.
 */
export const CWS_ITEM_ID = 'gnfhfenegmjdjlfclcabfmajgaiaheij';

export const reviewNudgeOptions: Omit<MountOptions, 'storage' | 'name' | 'strings'> = {
  reviewUrl: chromeWebStoreReviewUrl(CWS_ITEM_ID),
  feedbackUrl: 'https://github.com/brightbar-dev/browser-api-client/issues/new',
};

export function offersReview(isFirefox = import.meta.env.BROWSER === 'firefox'): boolean {
  return !isFirefox;
}

/**
 * Only at the start of an app tab: the first empty response pane of a page load may try once, and
 * the first send closes the window, so the request never appears between two requests in a session.
 */
let windowOpen = true;

export function closeReviewNudgeWindow(): void {
  windowOpen = false;
}

/** For tests: a fresh page load. */
export function resetReviewNudgeWindow(): void {
  windowOpen = true;
}

/** Count one request that got a response (any status). Never lets a storage failure reach a send. */
export async function recordRequestAnswered(): Promise<void> {
  if (!offersReview()) return;
  await recordActivation({ storage: browser.storage.local }).catch(() => {});
}

/** Show the request at the end of `container` if it has been earned and the window is still open. */
export async function showReviewNudge(container: HTMLElement): Promise<HTMLElement | null> {
  if (!offersReview() || !windowOpen) return null;
  windowOpen = false;
  const doc = container.ownerDocument;
  const shown = await mountReviewNudge(container, {
    ...reviewNudgeOptions,
    storage: browser.storage.local,
    name: t('appName'),
    strings: {
      prompt: (name) => t('reviewNudgePrompt', name),
      review: t('reviewNudgeReview'),
      feedback: t('reviewNudgeFeedback'),
      dismiss: t('reviewNudgeDismiss'),
    },
  }).catch(() => null);
  if (shown && !doc.getElementById('bb-review-nudge-css')) {
    doc.head.append(Object.assign(doc.createElement('style'), { id: 'bb-review-nudge-css', textContent: reviewNudgeCss }));
  }
  return shown;
}
