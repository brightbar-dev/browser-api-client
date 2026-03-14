import ExtPay from 'extpay';
import { EXTPAY_ID, resolveProStatus, maxHistory, maxEnvironments, collectionsEnabled } from '@/utils/payment';
import type { PaymentUser } from '@/utils/payment';

export default defineBackground(() => {
  let extpay: ReturnType<typeof ExtPay> | null = null;
  try {
    extpay = ExtPay(EXTPAY_ID);
    extpay.startBackground();
  } catch (err) {
    console.warn('ExtPay initialization failed (expected when running unpacked):', err);
  }

  /** Resolve current pro-unlocked status, defaulting to false on error. */
  async function isUnlocked(): Promise<boolean> {
    if (!extpay) return false;
    try {
      const user = await extpay.getUser();
      return resolveProStatus(user as PaymentUser).unlocked;
    } catch {
      return false;
    }
  }

  // Set defaults on install
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      await browser.storage.local.set({
        theme: 'auto',
        history: [],
        environments: [],
        collections: [],
        activeEnvId: null,
        maxHistory: 100,
      });
    }
  });

  // Execute API requests from the popup (bypass CORS via background)
  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg.action === 'executeRequest') {
      const { url, method, headers, body } = msg;
      const start = Date.now();

      try {
        const fetchOpts: RequestInit = { method, headers };
        if (body && method !== 'GET' && method !== 'HEAD') {
          fetchOpts.body = body;
        }

        const response = await fetch(url, fetchOpts);
        const responseBody = await response.text();
        const elapsed = Date.now() - start;

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });

        return {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody,
          size: new Blob([responseBody]).size,
          time: elapsed,
          contentType: response.headers.get('content-type') || '',
        };
      } catch (error) {
        return {
          status: 0,
          statusText: (error as Error).message || 'Network Error',
          headers: {},
          body: '',
          size: 0,
          time: Date.now() - start,
          contentType: '',
        };
      }
    }

    if (msg.action === 'getSettings') {
      return browser.storage.local.get(['theme', 'maxHistory', 'proUnlocked']);
    }

    if (msg.action === 'saveSettings') {
      return browser.storage.local.set(msg.settings);
    }

    if (msg.action === 'getHistory') {
      const { history = [] } = await browser.storage.local.get('history');
      return history;
    }

    if (msg.action === 'addHistory') {
      const unlocked = await isUnlocked();
      const limit = maxHistory(unlocked);
      const { history = [] } = await browser.storage.local.get('history');
      history.unshift(msg.entry);
      if (history.length > limit) history.length = limit;
      await browser.storage.local.set({ history });
      return true;
    }

    if (msg.action === 'clearHistory') {
      await browser.storage.local.set({ history: [] });
      return true;
    }

    if (msg.action === 'getEnvironments') {
      const { environments = [] } = await browser.storage.local.get('environments');
      return environments;
    }

    if (msg.action === 'saveEnvironments') {
      const unlocked = await isUnlocked();
      const max = maxEnvironments(unlocked);
      const envs = msg.environments || [];
      if (envs.length > max) {
        return { error: 'limit', max, current: envs.length };
      }
      return browser.storage.local.set({ environments: envs });
    }

    if (msg.action === 'getCollections') {
      const { collections = [] } = await browser.storage.local.get('collections');
      return collections;
    }

    if (msg.action === 'saveCollections') {
      const unlocked = await isUnlocked();
      if (!collectionsEnabled(unlocked)) {
        return { error: 'pro_required', feature: 'collections' };
      }
      return browser.storage.local.set({ collections: msg.collections });
    }

    if (msg.action === 'getProStatus') {
      if (!extpay) return { paid: false, paidAt: null, trialStartedAt: null };
      return extpay.getUser().then(user => ({
        paid: user.paid,
        paidAt: user.paidAt,
        trialStartedAt: user.trialStartedAt,
      })).catch(() => ({
        paid: false,
        paidAt: null,
        trialStartedAt: null,
      }));
    }

    if (msg.action === 'openPayment') {
      if (!extpay) return;
      return extpay.openPaymentPage();
    }

    if (msg.action === 'openTrial') {
      if (!extpay) return;
      return extpay.openTrialPage('7-day free trial');
    }

    if (msg.action === 'openLogin') {
      if (!extpay) return;
      return extpay.openLoginPage();
    }
  });
});
