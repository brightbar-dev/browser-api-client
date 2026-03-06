import ExtPay from 'extpay';
import { EXTPAY_ID } from '@/utils/payment';

export default defineBackground(() => {
  const extpay = ExtPay(EXTPAY_ID);
  extpay.startBackground();

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
      const { history = [], maxHistory = 100 } = await browser.storage.local.get(['history', 'maxHistory']);
      history.unshift(msg.entry);
      if (history.length > maxHistory) history.length = maxHistory;
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
      return browser.storage.local.set({ environments: msg.environments });
    }

    if (msg.action === 'getCollections') {
      const { collections = [] } = await browser.storage.local.get('collections');
      return collections;
    }

    if (msg.action === 'saveCollections') {
      return browser.storage.local.set({ collections: msg.collections });
    }

    if (msg.action === 'getProStatus') {
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
      return extpay.openPaymentPage();
    }

    if (msg.action === 'openTrial') {
      return extpay.openTrialPage('7-day free trial');
    }

    if (msg.action === 'openLogin') {
      return extpay.openLoginPage();
    }
  });
});
