import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readState } from '@brightbar-dev/review-nudge';
import {
  CWS_ITEM_ID,
  closeReviewNudgeWindow,
  offersReview,
  recordRequestAnswered,
  resetReviewNudgeWindow,
  reviewNudgeOptions,
  showReviewNudge,
} from '../utils/review-nudge';
import listing from '../store/cws.json';

describe('review nudge', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    resetReviewNudgeWindow();
  });

  it('asks for a review of this item and no other', () => {
    expect(CWS_ITEM_ID).toBe(listing.extension_id);
    expect(reviewNudgeOptions.reviewUrl).toBe(`https://chromewebstore.google.com/detail/${listing.extension_id}/reviews`);
  });

  it('sends problems to the listing’s support page, not the store', () => {
    expect(reviewNudgeOptions.feedbackUrl.startsWith(listing.support_url)).toBe(true);
  });

  it('never asks in the Firefox build, which is not on the Chrome Web Store', () => {
    expect(offersReview(true)).toBe(false);
    expect(offersReview(false)).toBe(true);
  });

  it('counts each answered request in storage.local', async () => {
    await recordRequestAnswered();
    await recordRequestAnswered();
    const state = await readState({ storage: fakeBrowser.storage.local });
    expect(state).toMatchObject({ status: 'counting', activations: 2, activeDays: 1 });
  });

  it('keeps a storage failure away from the send', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('quota'));
    await expect(recordRequestAnswered()).resolves.toBeUndefined();
  });

  it('shows nothing once a request has been sent in this page load', async () => {
    const eligible = { v: 1, status: 'counting', firstUseAt: Date.now() - 6 * 86_400_000, activations: 8, activeDays: 3, lastDay: '2000-01-01' };
    await fakeBrowser.storage.local.set({ reviewNudge: eligible });
    closeReviewNudgeWindow();
    // No DOM in these tests: a closed window must return before it ever touches the container.
    await expect(showReviewNudge({} as HTMLElement)).resolves.toBeNull();
    expect((await readState({ storage: fakeBrowser.storage.local }))?.status).toBe('counting');
  });

  it('tries at most once per page load, so a later empty pane never shows it', async () => {
    // Not yet earned: the first attempt renders nothing and still spends the page load's one try.
    await expect(showReviewNudge({ ownerDocument: {} } as HTMLElement)).resolves.toBeNull();
    const eligible = { v: 1, status: 'counting', firstUseAt: Date.now() - 6 * 86_400_000, activations: 8, activeDays: 3, lastDay: '2000-01-01' };
    await fakeBrowser.storage.local.set({ reviewNudge: eligible });
    await expect(showReviewNudge({} as HTMLElement)).resolves.toBeNull();
    expect((await readState({ storage: fakeBrowser.storage.local }))?.status).toBe('counting');
  });
});
