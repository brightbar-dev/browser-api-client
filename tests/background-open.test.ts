import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

// The toolbar button, the install defaults and the history writes: what runs on every use of the
// extension before the app page does anything.

const APP_URL = 'chrome-extension://test-id/app.html';

async function loadBackground() {
  const background = await import('../entrypoints/background');
  background.default.main();
}

async function send(message: unknown) {
  const [result] = await fakeBrowser.runtime.onMessage.trigger(message, {} as never, () => {});
  return result;
}

function clickToolbar(tab: { windowId: number; index: number }) {
  return fakeBrowser.action.onClicked.trigger(tab as never);
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.resetModules();
  vi.spyOn(fakeBrowser.runtime, 'getURL').mockImplementation(((path: string) => `chrome-extension://test-id${path}`) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (fakeBrowser.runtime as { getContexts?: unknown }).getContexts;
});

describe('toolbar button (Chrome, runtime.getContexts)', () => {
  it('focuses the app tab that is already open instead of opening another', async () => {
    (fakeBrowser.runtime as any).getContexts = vi.fn(async () => [
      { tabId: -1, windowId: 1, documentUrl: 'chrome-extension://test-id/options.html' },
      { tabId: 12, windowId: 3, documentUrl: `${APP_URL}#x` },
    ]);
    const update = vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never);
    const focus = vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as never);
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    await loadBackground();

    await clickToolbar({ windowId: 1, index: 0 });

    await vi.waitFor(() => expect(focus).toHaveBeenCalledWith(3, { focused: true }));
    expect(update).toHaveBeenCalledWith(12, { active: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('opens the app next to the current tab when none is open', async () => {
    (fakeBrowser.runtime as any).getContexts = vi.fn(async () => []);
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
    await loadBackground();

    await clickToolbar({ windowId: 7, index: 2 });

    await vi.waitFor(() => expect(create).toHaveBeenCalledWith({ url: APP_URL, windowId: 7, index: 3 }));
  });
});

describe('toolbar button (Firefox, no getContexts)', () => {
  it('lets an open app page focus itself', async () => {
    const ask = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(true as never);
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    await loadBackground();

    await clickToolbar({ windowId: 1, index: 0 });

    await vi.waitFor(() => expect(ask).toHaveBeenCalledWith({ action: 'focusApp' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(create).not.toHaveBeenCalled();
  });

  it('opens a new app tab when no page answers', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockRejectedValue(new Error('Receiving end does not exist'));
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
    await loadBackground();

    await clickToolbar({ windowId: 4, index: 0 });

    await vi.waitFor(() => expect(create).toHaveBeenCalledWith({ url: APP_URL, windowId: 4, index: 1 }));
  });
});

describe('install and history storage', () => {
  it('sets defaults on install, but not on update', async () => {
    await loadBackground();
    await fakeBrowser.storage.local.set({ history: [{ id: 'keep' }] });

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.5.0' } as never);
    expect(await fakeBrowser.storage.local.get('history')).toEqual({ history: [{ id: 'keep' }] });

    // Asserted on the write: the fake storage drops null values, which real storage keeps.
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' } as never);
    expect(set).toHaveBeenCalledWith({
      theme: 'auto', history: [], environments: [], collections: [], activeEnvId: null, maxHistory: 100,
    });
  });

  it('keeps every entry when two app tabs add history at the same moment', async () => {
    await loadBackground();

    await Promise.all(Array.from({ length: 20 }, (_, i) => send({ action: 'addHistory', entry: { id: `h${i}` } })));

    const history = (await send({ action: 'getHistory' })) as Array<{ id: string }>;
    expect(history).toHaveLength(20);
    expect(history[0]!.id).toBe('h19');
  });

  it('deletes only the chosen entries, and clears everything on request', async () => {
    await loadBackground();
    for (const id of ['a', 'b', 'c']) await send({ action: 'addHistory', entry: { id } });

    await send({ action: 'deleteHistory', ids: ['b'] });
    expect(((await send({ action: 'getHistory' })) as Array<{ id: string }>).map((h) => h.id)).toEqual(['c', 'a']);

    expect(await send({ action: 'clearHistory' })).toBe(true);
    expect(await send({ action: 'getHistory' })).toEqual([]);
  });

  it('a history write that follows a failed one still runs', async () => {
    await loadBackground();
    const set = vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));

    await expect(send({ action: 'addHistory', entry: { id: 'big' } })).rejects.toThrow(/quota/);
    set.mockRestore();
    await send({ action: 'addHistory', entry: { id: 'next' } });

    expect(((await send({ action: 'getHistory' })) as Array<{ id: string }>).map((h) => h.id)).toEqual(['next']);
  });
});
