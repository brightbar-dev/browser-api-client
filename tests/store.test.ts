import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { newRequest } from '../utils/request';

// IndexedDB and webRequest don't exist in Node: stand in for them.
const responses = new Map<string, unknown>();
vi.mock('@/utils/idb', () => ({
  idbGet: vi.fn(async (_store: string, key: string) => responses.get(key)),
  idbPut: vi.fn(async () => undefined),
  idbDelete: vi.fn(async (_store: string, key: string) => void responses.delete(key)),
}));
vi.mock('../entrypoints/app/network', () => ({ startNetworkObserver: vi.fn(async () => false) }));

type Store = typeof import('../entrypoints/app/store');
let store: Store;
let win: EventTarget;
let doc: EventTarget & { hidden: boolean };

beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ version: '0.6.0' } as never);
  responses.clear();
  vi.resetModules();
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  store = await import('../entrypoints/app/store');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const savedTab = (id: string, url: string) => ({ id, request: { ...newRequest('Saved'), url } });

describe('loadApp — opening the workspace', () => {
  it('first run: opens the sample request and shows the welcome, sending nothing', async () => {
    await store.loadApp();
    const s = store.getState();
    expect(s.ready).toBe(true);
    expect(s.welcomed).toBe(false);
    expect(s.workspace.tabs).toHaveLength(1);
    expect(s.workspace.tabs[0]!.request.url).toBe('https://httpbin.org/get?hello=world');
    expect(s.runs).toEqual({});
  });

  it('a user who was welcomed but closed every tab gets a blank tab, not the sample', async () => {
    await fakeBrowser.storage.local.set({ welcomed: true });
    await store.loadApp();
    expect(store.getState().welcomed).toBe(true);
    expect(store.getState().workspace.tabs[0]!.request.url).toBe('');
  });

  it('restores saved drafts and each tab’s last response', async () => {
    const workspace = { version: 1, tabs: [savedTab('t1', 'https://a.test/'), savedTab('t2', 'https://b.test/')], activeTabId: 't2' };
    responses.set('t2', { status: 204 });
    await fakeBrowser.storage.local.set({ workspace });

    await store.loadApp();

    const s = store.getState();
    expect(s.welcomed).toBe(true);
    expect(s.workspace.tabs.map((t) => [t.id, t.request.url])).toEqual([['t1', 'https://a.test/'], ['t2', 'https://b.test/']]);
    expect(s.workspace.activeTabId).toBe('t2');
    await vi.waitFor(() => expect(store.getState().runs.t2).toEqual({ state: 'done', response: { status: 204 }, warnings: [] }));
    expect(store.getState().runs.t1).toBeUndefined();
  });

  it('drops malformed stored data and clamps settings instead of failing to open', async () => {
    await fakeBrowser.storage.local.set({
      workspace: 'garbage',
      environments: [{ id: 'e1', name: 'Dev', variables: [] }, 42, null],
      collections: 'nope',
      history: [{ nonsense: true }],
      activeEnvId: 7,
      theme: 'purple',
      requestTimeout: 99999,
      layout: { sidebarWidth: 5000, requestFraction: -1, sidebarPanel: 'bogus', sidebarOpen: 'yes' },
    });

    await store.loadApp();

    const s = store.getState();
    expect(s.workspace.tabs).toHaveLength(1);
    expect(s.environments.map((e) => e.id)).toEqual(['e1']);
    expect(s.collections).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.activeEnvId).toBeNull();
    expect(s.theme).toBe('auto');
    expect(s.requestTimeout).toBe(600);
    expect(s.layout).toEqual({ sidebarOpen: true, sidebarWidth: 520, sidebarPanel: 'history', requestFraction: 0.15 });
  });

  it('follows changes other pages make to storage (history from the background, settings from Options)', async () => {
    await store.loadApp();
    const entry = { id: 'h1', timestamp: 1, request: newRequest(), response: { status: 200, statusText: 'OK', headers: {}, body: '', size: 0, time: 1, contentType: '' } };

    await fakeBrowser.storage.local.set({ history: [entry], theme: 'dark', requestTimeout: 30, activeEnvId: 'e9' });

    const s = store.getState();
    expect(s.history.map((h) => h.id)).toEqual(['h1']);
    expect(s.theme).toBe('dark');
    expect(s.requestTimeout).toBe(30);
    expect(s.activeEnvId).toBe('e9');
  });
});

describe('draft persistence', () => {
  it('writes edits to storage shortly after typing stops, once', async () => {
    await store.loadApp();
    const tabId = store.getState().workspace.activeTabId;
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    vi.useFakeTimers();

    store.updateRequest(tabId, (r) => ({ ...r, url: 'https://a' }));
    store.updateRequest(tabId, (r) => ({ ...r, url: 'https://ab' }));
    store.updateRequest(tabId, (r) => ({ ...r, url: 'https://abc' }));
    expect(set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);

    expect(set).toHaveBeenCalledTimes(1);
    expect((set.mock.calls[0]![0] as any).workspace.tabs[0].request.url).toBe('https://abc');
  });

  it('flushes a pending draft at once when the page hides or unloads', async () => {
    await store.loadApp();
    const tabId = store.getState().workspace.activeTabId;
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');

    store.updateRequest(tabId, (r) => ({ ...r, url: 'https://typed.test/' }));
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(set).toHaveBeenCalledTimes(1);

    store.updateRequest(tabId, (r) => ({ ...r, method: 'POST' }));
    win.dispatchEvent(new Event('pagehide'));
    expect(set).toHaveBeenCalledTimes(2);
    const { workspace } = (await fakeBrowser.storage.local.get('workspace')) as any;
    expect(workspace.tabs[0].request).toMatchObject({ url: 'https://typed.test/', method: 'POST' });
  });

  it('does not write while loading, so a half-loaded state never overwrites saved drafts', async () => {
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    store.flushWorkspace();
    expect(set).not.toHaveBeenCalled();
  });

  it('an edit that changes nothing is not written', async () => {
    await store.loadApp();
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    vi.useFakeTimers();
    store.updateRequest('no-such-tab', (r) => ({ ...r, url: 'x' }));
    vi.advanceTimersByTime(1000);
    expect(set).not.toHaveBeenCalled();
  });

  it('closing a tab forgets its response', async () => {
    await store.loadApp();
    store.newTab();
    const [first] = store.getState().workspace.tabs;
    store.setRun(first!.id, { state: 'done', warnings: [] });
    responses.set(first!.id, {});

    store.closeTab(first!.id);

    expect(store.getState().runs[first!.id]).toBeUndefined();
    expect(store.getState().workspace.tabs.map((t) => t.id)).not.toContain(first!.id);
    await vi.waitFor(() => expect(responses.has(first!.id)).toBe(false));
  });
});

describe('activeVariables and markWelcomed', () => {
  it('only enabled, named variables of the active environment are used', () => {
    store.setState((s) => ({
      ...s,
      environments: [
        { id: 'a', name: 'A', variables: [{ key: 'x', value: '1', enabled: true }, { key: 'y', value: '2', enabled: false }, { key: '', value: '3', enabled: true }] },
        { id: 'b', name: 'B', variables: [{ key: 'z', value: '9', enabled: true }] },
      ],
      activeEnvId: 'a',
    }));
    expect(store.activeVariables().map((v) => v.key)).toEqual(['x']);
    store.setActiveEnv(null);
    expect(store.activeVariables()).toEqual([]);
  });

  it('the first send stores welcomed once', async () => {
    await store.loadApp();
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    store.markWelcomed();
    store.markWelcomed();
    expect(set).toHaveBeenCalledTimes(1);
    expect(await fakeBrowser.storage.local.get('welcomed')).toEqual({ welcomed: true });
  });
});
