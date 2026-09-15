import type { Browser } from 'wxt/browser';

export default defineBackground(() => {
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

  // The toolbar button opens the app in a tab, or focuses the one already open.
  const action = browser.action ?? (browser as unknown as { browserAction: typeof browser.action }).browserAction;
  action.onClicked.addListener((tab) => {
    openApp(tab).catch((err) => console.error('Could not open the app:', err));
  });

  // Writes that read-modify-write one key run one at a time, so two app tabs can't interleave.
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  }

  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg.action === 'getSettings') {
      const settings = await browser.storage.local.get(['theme', 'maxHistory']);
      return settings;
    }

    if (msg.action === 'saveSettings') {
      return browser.storage.local.set(msg.settings);
    }

    if (msg.action === 'getHistory') {
      const { history = [] } = await browser.storage.local.get('history');
      return history;
    }

    if (msg.action === 'addHistory') {
      return serialized(async () => {
        const stored = await browser.storage.local.get(['history', 'maxHistory']);
        const history = Array.isArray(stored.history) ? stored.history : [];
        const maxHistory = typeof stored.maxHistory === 'number' ? stored.maxHistory : 100;
        history.unshift(msg.entry);
        if (history.length > maxHistory) history.length = maxHistory;
        await browser.storage.local.set({ history });
        return true;
      });
    }

    if (msg.action === 'deleteHistory') {
      return serialized(async () => {
        const ids = new Set<string>(msg.ids || []);
        const stored = await browser.storage.local.get('history');
        const history = Array.isArray(stored.history) ? stored.history : [];
        await browser.storage.local.set({ history: history.filter((h: { id: string }) => !ids.has(h.id)) });
        return true;
      });
    }

    if (msg.action === 'clearHistory') {
      await serialized(() => browser.storage.local.set({ history: [] }));
      return true;
    }

    if (msg.action === 'getEnvironments') {
      const { environments = [] } = await browser.storage.local.get('environments');
      return environments;
    }

    if (msg.action === 'saveEnvironments') {
      return browser.storage.local.set({ environments: msg.environments || [] });
    }

    if (msg.action === 'getCollections') {
      const { collections = [] } = await browser.storage.local.get('collections');
      return collections;
    }

    if (msg.action === 'saveCollections') {
      return browser.storage.local.set({ collections: msg.collections });
    }
  });
});

async function openApp(fromTab?: Browser.tabs.Tab) {
  const appUrl = browser.runtime.getURL('/app.html');
  const runtime = browser.runtime as typeof browser.runtime & {
    getContexts?: (filter: { contextTypes: string[] }) => Promise<Array<{ tabId: number; windowId: number; documentUrl?: string }>>;
  };

  if (typeof runtime.getContexts === 'function') {
    // Chrome: find our own app tab; needs no "tabs" permission.
    const contexts = await runtime.getContexts({ contextTypes: ['TAB'] });
    const open = contexts.find((c) => c.tabId >= 0 && c.documentUrl?.startsWith(appUrl));
    if (open) {
      await browser.tabs.update(open.tabId, { active: true });
      await browser.windows.update(open.windowId, { focused: true });
      return;
    }
  } else {
    // Firefox: an open app page answers by focusing itself.
    try {
      if (await browser.runtime.sendMessage({ action: 'focusApp' })) return;
    } catch {
      // no app page is open
    }
  }

  await browser.tabs.create({
    url: appUrl,
    windowId: fromTab?.windowId,
    index: fromTab && fromTab.index >= 0 ? fromTab.index + 1 : undefined,
  });
}
