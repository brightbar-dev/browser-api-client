import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { newRequest, type ApiRequest } from '../utils/request';
import { newTab, newWorkspace, isTabDirty } from '../utils/workspace';
import type { Collection } from '../utils/collections';

vi.mock('@/utils/idb', () => ({ idbGet: vi.fn(async () => undefined), idbPut: vi.fn(async () => undefined), idbDelete: vi.fn(async () => undefined) }));
vi.mock('../entrypoints/app/network', () => ({ startNetworkObserver: vi.fn(async () => false) }));

const store = await import('../entrypoints/app/store');
const lib = await import('../entrypoints/app/library');

function collection(id: string, requests: ApiRequest[] = [], folders: Collection['folders'] = []): Collection {
  return { id, name: id, requests, folders } as Collection;
}

function openTabs(...requests: Array<{ request: ApiRequest; source?: { collectionId: string; requestId: string } }>): string[] {
  const ws = newWorkspace();
  ws.tabs = requests.map(({ request, source }) => ({ ...newTab(request), ...(source ? { source } : {}) }));
  ws.activeTabId = ws.tabs[0]!.id;
  store.setState((s) => ({ ...s, workspace: ws }));
  return ws.tabs.map((t) => t.id);
}

async function storedCollections(): Promise<Collection[]> {
  return ((await fakeBrowser.storage.local.get('collections')) as { collections: Collection[] }).collections;
}

beforeEach(() => {
  fakeBrowser.reset();
  store.setState((s) => ({ ...s, ready: true, collections: [], environments: [], activeEnvId: null, dialog: null, toast: null }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('saving a tab to a collection', () => {
  it('a scratch tab becomes a new request in the chosen folder, and the tab is no longer dirty', async () => {
    store.setState((s) => ({ ...s, collections: [collection('c1', [], [{ id: 'f1', name: 'Users', requests: [] }])] }));
    const [tabId] = openTabs({ request: { ...newRequest('draft'), url: 'https://api.test/users' } });

    lib.saveTabToCollection(tabId!, { collectionId: 'c1', folderId: 'f1', name: 'List users' });

    const [c] = await storedCollections();
    expect(c!.requests).toEqual([]);
    expect(c!.folders![0]!.requests).toEqual([expect.objectContaining({ name: 'List users', url: 'https://api.test/users' })]);
    const tab = store.findTab(tabId!)!;
    expect(tab.source).toEqual({ collectionId: 'c1', requestId: c!.folders![0]!.requests[0]!.id });
    expect(tab.request.name).toBe('List users');
    expect(isTabDirty(tab)).toBe(false);
  });

  it('saving the same tab again updates that request instead of adding a copy', async () => {
    store.setState((s) => ({ ...s, collections: [collection('c1')] }));
    const [tabId] = openTabs({ request: { ...newRequest('r'), url: 'https://api.test/v1' } });
    lib.saveTabToCollection(tabId!, { collectionId: 'c1', folderId: null, name: 'Thing' });
    store.updateRequest(tabId!, (r) => ({ ...r, url: 'https://api.test/v2' }));

    lib.saveTabToCollection(tabId!, { collectionId: 'c1', folderId: null, name: 'Thing' });

    const [c] = await storedCollections();
    expect(c!.requests.map((r) => r.url)).toEqual(['https://api.test/v2']);
  });

  it('the saved copy does not share objects with the open draft', () => {
    store.setState((s) => ({ ...s, collections: [collection('c1')] }));
    const [tabId] = openTabs({ request: { ...newRequest('r'), headers: [{ key: 'A', value: '1', enabled: true }] } });
    lib.saveTabToCollection(tabId!, { collectionId: 'c1', folderId: null, name: 'r' });

    store.findTab(tabId!)!.request.headers[0]!.value = 'mutated';

    expect(store.getState().collections[0]!.requests[0]!.headers[0]!.value).toBe('1');
  });
});

describe('Cmd/Ctrl+S (requestSave)', () => {
  it('saves in place, in its folder, when the tab came from a collection', async () => {
    const saved = { ...newRequest('Get'), id: 'r1', url: 'https://api.test/old' };
    store.setState((s) => ({ ...s, collections: [collection('c1', [], [{ id: 'f1', name: 'F', requests: [saved] }])] }));
    const [tabId] = openTabs({ request: { ...saved, url: 'https://api.test/new' }, source: { collectionId: 'c1', requestId: 'r1' } });

    lib.requestSave(tabId!);

    const [c] = await storedCollections();
    expect(c!.folders![0]!.requests.map((r) => [r.id, r.url])).toEqual([['r1', 'https://api.test/new']]);
    expect(c!.requests).toEqual([]);
    expect(store.getState().toast?.message).toBe('Saved');
    expect(store.getState().dialog).toBeNull();
  });

  it('asks where to save when the tab has no home, or its collection was deleted', () => {
    const [scratch, orphan] = openTabs(
      { request: newRequest('a') },
      { request: newRequest('b'), source: { collectionId: 'gone', requestId: 'r1' } },
    );

    lib.requestSave(scratch!);
    expect(store.getState().dialog).toEqual({ type: 'save', tabId: scratch });
    lib.requestSave(orphan!);
    expect(store.getState().dialog).toEqual({ type: 'save', tabId: orphan });
  });
});

describe('moving a request to another collection', () => {
  it('moves it and repoints any open tab at its new home', async () => {
    const r = { ...newRequest('Moved'), id: 'r1' };
    store.setState((s) => ({ ...s, collections: [collection('from', [r]), collection('to', [{ ...newRequest('Other'), id: 'r2' }])] }));
    const [tabId] = openTabs({ request: r, source: { collectionId: 'from', requestId: 'r1' } });

    lib.moveRequestAcross('from', 'r1', 'to', { folderId: null, index: 0 });

    const [from, to] = await storedCollections();
    expect(from!.requests).toEqual([]);
    expect(to!.requests.map((x) => x.id)).toEqual(['r1', 'r2']);
    expect(store.findTab(tabId!)!.source).toEqual({ collectionId: 'to', requestId: 'r1' });
  });
});

describe('environments', () => {
  it('deleting the active environment deactivates it', async () => {
    store.setState((s) => ({ ...s, environments: [{ id: 'e1', name: 'Dev', variables: [] }], activeEnvId: 'e1' }));
    // Asserted on the writes: the fake storage drops null values, which real storage keeps.
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');

    lib.deleteEnvironment('e1');

    expect(store.getState().activeEnvId).toBeNull();
    expect(set).toHaveBeenCalledWith({ activeEnvId: null });
    expect(set).toHaveBeenCalledWith({ environments: [] });
    set.mockRestore();
  });

  it('per-keystroke edits update state at once and write storage once, after a pause', async () => {
    store.setState((s) => ({ ...s, environments: [{ id: 'e1', name: 'Dev', variables: [] }] }));
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    vi.useFakeTimers();

    for (const name of ['P', 'Pr', 'Pro', 'Prod']) lib.updateEnvironment('e1', (e) => ({ ...e, name }), true);
    expect(store.getState().environments[0]!.name).toBe('Prod');
    expect(set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ environments: [expect.objectContaining({ name: 'Prod' })] });
    set.mockRestore();
  });
});
