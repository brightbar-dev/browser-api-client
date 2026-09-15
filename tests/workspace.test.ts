import { describe, it, expect } from 'vitest';
import {
  newTab, newWorkspace, requestSignature, isBlankRequest, isTabDirty, activeTab, tabTitle, addTab,
  openRequest, closeTab, activateTab, updateTabRequest, markTabSaved, moveTab, restoreWorkspace, MAX_TABS,
} from '../utils/workspace';
import type { Workspace, WorkspaceTab } from '../utils/workspace';
import { newRequest } from '../utils/request';
import type { ApiRequest } from '../utils/request';

function withUrl(url: string, overrides: Partial<ApiRequest> = {}): ApiRequest {
  return { ...newRequest(), url, ...overrides };
}

function ws(tabs: WorkspaceTab[], activeIndex = 0): Workspace {
  return { version: 1, tabs, activeTabId: tabs[activeIndex]!.id };
}

function tab(id: string, request: ApiRequest = newRequest(), extra: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return { id, request, ...extra };
}

describe('newWorkspace / newTab', () => {
  it('starts with one blank, active scratch tab', () => {
    const w = newWorkspace();
    expect(w.version).toBe(1);
    expect(w.tabs).toHaveLength(1);
    expect(w.activeTabId).toBe(w.tabs[0]!.id);
    expect(isBlankRequest(w.tabs[0]!.request)).toBe(true);
    expect(w.tabs[0]!.source).toBeUndefined();
    expect(w.tabs[0]!.baseline).toBeUndefined();
  });

  it('newTab wraps a given request with a fresh id', () => {
    const r = withUrl('https://x.com');
    const t = newTab(r);
    expect(t.request).toBe(r);
    expect(t.id).toBeTruthy();
    expect(newTab().id).not.toBe(t.id);
  });
});

describe('requestSignature', () => {
  it('ignores the request id', () => {
    const r = withUrl('https://x.com');
    expect(requestSignature({ ...r, id: 'one' })).toBe(requestSignature({ ...r, id: 'two' }));
  });

  it('changes when anything else changes', () => {
    const r = withUrl('https://x.com');
    expect(requestSignature(r)).not.toBe(requestSignature({ ...r, url: 'https://y.com' }));
    expect(requestSignature(r)).not.toBe(requestSignature({ ...r, method: 'POST' }));
    expect(requestSignature(r)).not.toBe(requestSignature({ ...r, headers: [{ key: 'a', value: 'b', enabled: false }] }));
  });

  it('does not contain the id', () => {
    expect(requestSignature({ ...newRequest(), id: 'unique-id-xyz' })).not.toContain('unique-id-xyz');
  });
});

describe('isBlankRequest', () => {
  it('is true for a new request, and for whitespace-only url and body', () => {
    expect(isBlankRequest(newRequest())).toBe(true);
    expect(isBlankRequest(withUrl('   ', { body: '\n  ' }))).toBe(true);
  });

  it('ignores empty rows, the method, the name and the body type', () => {
    expect(isBlankRequest(withUrl('', {
      method: 'POST',
      name: 'Something',
      bodyType: 'json',
      headers: [{ key: '', value: '', enabled: true }],
      params: [{ key: '', value: '', enabled: false }],
      formFields: [{ key: '', value: '', enabled: true }],
      multipartFields: [{ key: '', value: '', enabled: true, kind: 'file' }],
    }))).toBe(true);
  });

  it.each<[string, Partial<ApiRequest>]>([
    ['url', { url: 'x' }],
    ['header key', { headers: [{ key: 'a', value: '', enabled: false }] }],
    ['header value', { headers: [{ key: '', value: 'b', enabled: true }] }],
    ['param', { params: [{ key: 'q', value: '', enabled: true }] }],
    ['body', { body: '{}' }],
    ['form field', { formFields: [{ key: '', value: 'v', enabled: true }] }],
    ['multipart file', { multipartFields: [{ key: '', value: '', enabled: true, kind: 'file', file: { id: 'f', name: 'a', size: 1, type: '' } }] }],
    ['binary file', { binaryFile: { id: 'f', name: 'a', size: 1, type: '' } }],
    ['auth', { auth: { type: 'bearer' } }],
  ])('is false with a %s', (_label, overrides) => {
    expect(isBlankRequest({ ...newRequest(), ...overrides })).toBe(false);
  });
});

describe('isTabDirty', () => {
  it('scratch tabs are dirty only when they hold something', () => {
    expect(isTabDirty(tab('a'))).toBe(false);
    expect(isTabDirty(tab('a', withUrl('https://x.com')))).toBe(true);
  });

  it('saved tabs compare against their baseline', () => {
    const r = withUrl('https://x.com');
    const saved = tab('a', r, { source: { collectionId: 'c', requestId: r.id }, baseline: requestSignature(r) });
    expect(isTabDirty(saved)).toBe(false);
    expect(isTabDirty({ ...saved, request: { ...r, url: 'https://y.com' } })).toBe(true);
    expect(isTabDirty({ ...saved, request: { ...r } })).toBe(false);
  });

  it('a saved blank request is not dirty, and clearing a saved request makes it dirty', () => {
    const blank = newRequest();
    expect(isTabDirty(tab('a', blank, { baseline: requestSignature(blank) }))).toBe(false);
    const r = withUrl('https://x.com');
    expect(isTabDirty(tab('a', { ...r, url: '' }, { baseline: requestSignature(r) }))).toBe(true);
  });
});

describe('activeTab', () => {
  it('returns the active tab', () => {
    const w = ws([tab('a'), tab('b')], 1);
    expect(activeTab(w).id).toBe('b');
  });

  it('falls back to the first tab for a dangling id', () => {
    expect(activeTab({ version: 1, tabs: [tab('a'), tab('b')], activeTabId: 'gone' }).id).toBe('a');
  });
});

describe('tabTitle', () => {
  it('uses the saved name for a tab with a source', () => {
    expect(tabTitle(tab('a', withUrl('https://x.com/a', { name: 'Get users' }), { source: { collectionId: 'c', requestId: 'r' } }))).toBe('Get users');
    expect(tabTitle(tab('a', withUrl('https://x.com/a', { name: 'New Request' }), { source: { collectionId: 'c', requestId: 'r' } }))).toBe('New Request');
  });

  it('uses "Untitled request" for a saved tab with an empty name', () => {
    expect(tabTitle(tab('a', withUrl('https://x.com/a', { name: '' }), { source: { collectionId: 'c', requestId: 'r' } }))).toBe('Untitled request');
  });

  it('uses a custom name on a scratch tab', () => {
    expect(tabTitle(tab('a', withUrl('https://x.com/a', { name: 'Draft' })))).toBe('Draft');
  });

  it('uses host/path without scheme, query or fragment for an unnamed request', () => {
    expect(tabTitle(tab('a', withUrl('  HTTPS://api.example.com/users?page=2#top ')))).toBe('api.example.com/users');
    expect(tabTitle(tab('a', withUrl('{{baseUrl}}/orders?x=1')))).toBe('{{baseUrl}}/orders');
  });

  it('falls back to "Untitled request"', () => {
    expect(tabTitle(tab('a'))).toBe('Untitled request');
    expect(tabTitle(tab('a', withUrl('', { name: '' })))).toBe('Untitled request');
    expect(tabTitle(tab('a', withUrl('?q=1')))).toBe('Untitled request');
  });
});

describe('addTab', () => {
  it('appends and activates the tab without mutating the input', () => {
    const w = newWorkspace();
    const t = tab('new');
    const next = addTab(w, t);
    expect(next.tabs.map(x => x.id)).toEqual([w.tabs[0]!.id, 'new']);
    expect(next.activeTabId).toBe('new');
    expect(w.tabs).toHaveLength(1);
  });

  it('creates a blank tab by default', () => {
    const next = addTab(newWorkspace());
    expect(next.tabs).toHaveLength(2);
    expect(isBlankRequest(activeTab(next).request)).toBe(true);
  });

  it(`past MAX_TABS (${MAX_TABS}) evicts the oldest clean tab only`, () => {
    const tabs: WorkspaceTab[] = [tab('dirty0', withUrl('https://a.com'))];
    for (let i = 1; i < MAX_TABS; i++) tabs.push(tab(`clean${i}`));
    const next = addTab(ws(tabs), tab('new', withUrl('https://new.com')));
    expect(next.tabs).toHaveLength(MAX_TABS);
    expect(next.tabs.map(t => t.id)).not.toContain('clean1');
    expect(next.tabs[0]!.id).toBe('dirty0');
    expect(next.tabs[1]!.id).toBe('clean2');
    expect(next.tabs[MAX_TABS - 1]!.id).toBe('new');
    expect(next.activeTabId).toBe('new');
  });

  it('treats an unchanged saved tab as clean for eviction', () => {
    const r = withUrl('https://saved.com');
    const tabs: WorkspaceTab[] = [];
    for (let i = 0; i < MAX_TABS; i++) tabs.push(tab(`d${i}`, withUrl(`https://d${i}.com`)));
    tabs[5] = tab('saved', r, { source: { collectionId: 'c', requestId: r.id }, baseline: requestSignature(r) });
    const next = addTab(ws(tabs), tab('new'));
    expect(next.tabs).toHaveLength(MAX_TABS);
    expect(next.tabs.map(t => t.id)).not.toContain('saved');
  });

  it('keeps every tab when all existing tabs are dirty, and never evicts the new tab', () => {
    const tabs: WorkspaceTab[] = [];
    for (let i = 0; i < MAX_TABS; i++) tabs.push(tab(`d${i}`, withUrl(`https://d${i}.com`)));
    const next = addTab(ws(tabs), tab('new'));
    expect(next.tabs).toHaveLength(MAX_TABS + 1);
    expect(next.tabs[MAX_TABS]!.id).toBe('new');
  });
});

describe('openRequest', () => {
  const source = { collectionId: 'c1', requestId: 'r1' };

  it('focuses a tab that already has the saved request open', () => {
    const r = withUrl('https://x.com', { id: 'r1' });
    const w = ws([tab('scratch', withUrl('https://typed.com')), tab('saved', r, { source, baseline: requestSignature(r) })]);
    const next = openRequest(w, withUrl('https://other.com'), { ...source });
    expect(next.tabs).toBe(w.tabs);
    expect(next.activeTabId).toBe('saved');
  });

  it('reuses a blank active scratch tab', () => {
    const w = newWorkspace();
    const r = withUrl('https://x.com', { id: 'r1', name: 'List' });
    const next = openRequest(w, r, source);
    expect(next.tabs).toHaveLength(1);
    const t = next.tabs[0]!;
    expect(t.id).not.toBe(w.tabs[0]!.id);
    expect(next.activeTabId).toBe(t.id);
    expect(t.source).toEqual(source);
    expect(t.request).toEqual(r);
    expect(t.baseline).toBe(requestSignature(r));
    expect(isTabDirty(t)).toBe(false);
  });

  it('reuses the blank scratch tab in place when it is not last', () => {
    const w = ws([tab('a', withUrl('https://a.com')), tab('blank'), tab('c', withUrl('https://c.com'))], 1);
    const next = openRequest(w, withUrl('https://x.com'), source);
    expect(next.tabs).toHaveLength(3);
    expect(next.tabs[0]!.id).toBe('a');
    expect(next.tabs[1]!.id).toBe(next.activeTabId);
    expect(next.tabs[2]!.id).toBe('c');
  });

  it('appends when the active scratch tab has content', () => {
    const w = ws([tab('typed', withUrl('https://typed.com'))]);
    const next = openRequest(w, withUrl('https://x.com'), source);
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[0]!.id).toBe('typed');
    expect(next.activeTabId).toBe(next.tabs[1]!.id);
  });

  it('appends when the active tab is a blank but saved request', () => {
    const blank = newRequest();
    const w = ws([tab('savedBlank', blank, { source: { collectionId: 'c9', requestId: blank.id }, baseline: requestSignature(blank) })]);
    const next = openRequest(w, withUrl('https://x.com'), source);
    expect(next.tabs).toHaveLength(2);
  });

  it('appends when a blank scratch tab exists but is not active', () => {
    const w = ws([tab('blank'), tab('typed', withUrl('https://typed.com'))], 1);
    expect(openRequest(w, withUrl('https://x.com'), source).tabs).toHaveLength(3);
  });

  it('opens a different saved request in a new tab', () => {
    const r = withUrl('https://x.com');
    const w = ws([tab('saved', r, { source, baseline: requestSignature(r) })]);
    const next = openRequest(w, withUrl('https://y.com'), { collectionId: 'c1', requestId: 'r2' });
    expect(next.tabs).toHaveLength(2);
    expect(activeTab(next).source).toEqual({ collectionId: 'c1', requestId: 'r2' });
  });

  it('opens without a source as a scratch tab (no baseline)', () => {
    const next = openRequest(newWorkspace(), withUrl('https://history.com'));
    const t = activeTab(next);
    expect(t.source).toBeUndefined();
    expect(t.baseline).toBeUndefined();
    expect(isTabDirty(t)).toBe(true);
  });

  it('deep-copies the request so later edits do not touch the source', () => {
    const original = withUrl('https://x.com', { headers: [{ key: 'A', value: '1', enabled: true }], auth: { type: 'bearer', token: 't' } });
    const next = openRequest(newWorkspace(), original, source);
    const opened = activeTab(next).request;
    expect(opened).not.toBe(original);
    expect(opened.headers).not.toBe(original.headers);
    opened.headers[0]!.value = 'changed';
    opened.auth.token = 'changed';
    expect(original.headers[0]!.value).toBe('1');
    expect(original.auth.token).toBe('t');
  });

  it('deep-copies so later edits to the source do not touch the tab', () => {
    const original = withUrl('https://x.com', { params: [{ key: 'q', value: '1', enabled: true }] });
    const next = openRequest(newWorkspace(), original, source);
    original.params[0]!.value = 'mutated';
    expect(activeTab(next).request.params[0]!.value).toBe('1');
    expect(isTabDirty(activeTab(next))).toBe(false);
  });
});

describe('closeTab', () => {
  const three = () => ws([tab('a', withUrl('https://a.com')), tab('b', withUrl('https://b.com')), tab('c', withUrl('https://c.com'))], 1);

  it('activates the right-hand neighbour when closing the active tab', () => {
    const next = closeTab(three(), 'b');
    expect(next.tabs.map(t => t.id)).toEqual(['a', 'c']);
    expect(next.activeTabId).toBe('c');
  });

  it('activates the left-hand neighbour when closing the active last tab', () => {
    const next = closeTab({ ...three(), activeTabId: 'c' }, 'c');
    expect(next.tabs.map(t => t.id)).toEqual(['a', 'b']);
    expect(next.activeTabId).toBe('b');
  });

  it('keeps the active tab when closing another', () => {
    const next = closeTab(three(), 'a');
    expect(next.tabs.map(t => t.id)).toEqual(['b', 'c']);
    expect(next.activeTabId).toBe('b');
  });

  it('returns the same workspace for an unknown id', () => {
    const w = three();
    expect(closeTab(w, 'nope')).toBe(w);
  });

  it('leaves one blank tab after closing the last tab', () => {
    const w = ws([tab('only', withUrl('https://x.com'))]);
    const next = closeTab(w, 'only');
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0]!.id).not.toBe('only');
    expect(next.activeTabId).toBe(next.tabs[0]!.id);
    expect(isBlankRequest(next.tabs[0]!.request)).toBe(true);
  });
});

describe('activateTab', () => {
  it('activates a known tab', () => {
    expect(activateTab(ws([tab('a'), tab('b')]), 'b').activeTabId).toBe('b');
  });

  it('is a no-op for an unknown id', () => {
    const w = ws([tab('a'), tab('b')]);
    expect(activateTab(w, 'zzz')).toBe(w);
  });
});

describe('updateTabRequest', () => {
  it('replaces only the target tab request', () => {
    const w = ws([tab('a'), tab('b')]);
    const r = withUrl('https://new.com');
    const next = updateTabRequest(w, 'b', r);
    expect(next.tabs[1]!.request).toBe(r);
    expect(next.tabs[0]).toBe(w.tabs[0]);
    expect(w.tabs[1]!.request.url).toBe('');
  });

  it('keeps source and baseline, so the tab becomes dirty', () => {
    const r = withUrl('https://x.com');
    const w = ws([tab('a', r, { source: { collectionId: 'c', requestId: r.id }, baseline: requestSignature(r) })]);
    const next = updateTabRequest(w, 'a', { ...r, method: 'DELETE' });
    expect(next.tabs[0]!.source).toEqual({ collectionId: 'c', requestId: r.id });
    expect(isTabDirty(next.tabs[0]!)).toBe(true);
  });

  it('changes nothing for an unknown id', () => {
    const w = ws([tab('a')]);
    const next = updateTabRequest(w, 'zzz', withUrl('https://x.com'));
    expect(next.tabs).toEqual(w.tabs);
  });
});

describe('markTabSaved', () => {
  it('sets source and baseline so the tab is clean until edited again', () => {
    const r = withUrl('https://x.com');
    const w = ws([tab('a', r), tab('b')]);
    const saved = markTabSaved(w, 'a', { collectionId: 'c1', requestId: r.id });
    const t = saved.tabs[0]!;
    expect(t.source).toEqual({ collectionId: 'c1', requestId: r.id });
    expect(t.baseline).toBe(requestSignature(r));
    expect(isTabDirty(t)).toBe(false);
    expect(saved.tabs[1]).toBe(w.tabs[1]);
    const edited = updateTabRequest(saved, 'a', { ...r, body: 'x' });
    expect(isTabDirty(edited.tabs[0]!)).toBe(true);
  });
});

describe('moveTab', () => {
  const abc = () => ws([tab('a'), tab('b'), tab('c')], 1);
  const ids = (w: Workspace) => w.tabs.map(t => t.id);

  it('moves forwards and backwards', () => {
    expect(ids(moveTab(abc(), 0, 2))).toEqual(['b', 'c', 'a']);
    expect(ids(moveTab(abc(), 2, 0))).toEqual(['c', 'a', 'b']);
    expect(ids(moveTab(abc(), 1, 2))).toEqual(['a', 'c', 'b']);
  });

  it('keeps the active tab and does not mutate the input', () => {
    const w = abc();
    const next = moveTab(w, 0, 2);
    expect(next.activeTabId).toBe('b');
    expect(ids(w)).toEqual(['a', 'b', 'c']);
  });

  it('returns the same workspace for same-index or out-of-bounds moves', () => {
    const w = abc();
    expect(moveTab(w, 1, 1)).toBe(w);
    expect(moveTab(w, -1, 0)).toBe(w);
    expect(moveTab(w, 0, -1)).toBe(w);
    expect(moveTab(w, 3, 0)).toBe(w);
    expect(moveTab(w, 0, 3)).toBe(w);
  });
});

describe('restoreWorkspace', () => {
  function expectFresh(w: Workspace) {
    expect(w.version).toBe(1);
    expect(w.tabs).toHaveLength(1);
    expect(w.activeTabId).toBe(w.tabs[0]!.id);
    expect(isBlankRequest(w.tabs[0]!.request)).toBe(true);
  }

  it.each([null, undefined, 'workspace', 42, true, [], {}, { tabs: 'nope' }, { tabs: [] }, { tabs: {} }])(
    'returns a fresh workspace for %j',
    raw => {
      expectFresh(restoreWorkspace(raw));
    },
  );

  it('drops malformed tabs and returns a fresh workspace if none survive', () => {
    expectFresh(restoreWorkspace({ tabs: [null, 5, 'x', [], { id: 'a' }, { id: 'b', request: null }, { id: 'c', request: 'str' }] }));
  });

  it('keeps well-formed tabs among malformed ones', () => {
    const w = restoreWorkspace({ tabs: [null, { id: 'good', request: { url: 'https://x.com' } }, { request: 7 }], activeTabId: 'good' });
    expect(w.tabs.map(t => t.id)).toEqual(['good']);
    expect(w.activeTabId).toBe('good');
  });

  it('fills in a partial request and a missing tab id', () => {
    const w = restoreWorkspace({ tabs: [{ request: { url: 'https://x.com', method: 'post' } }] });
    const t = w.tabs[0]!;
    expect(typeof t.id).toBe('string');
    expect(t.id).not.toBe('');
    expect(t.request).toMatchObject({ url: 'https://x.com', method: 'POST', headers: [], params: [], body: '', bodyType: 'none', auth: { type: 'none' } });
    expect(w.activeTabId).toBe(t.id);
  });

  it('fixes a dangling or non-string activeTabId', () => {
    const tabs = [{ id: 'a', request: {} }, { id: 'b', request: {} }];
    expect(restoreWorkspace({ tabs, activeTabId: 'gone' }).activeTabId).toBe('a');
    expect(restoreWorkspace({ tabs, activeTabId: { id: 'b' } }).activeTabId).toBe('a');
    expect(restoreWorkspace({ tabs, activeTabId: 'b' }).activeTabId).toBe('b');
  });

  it('keeps a valid source and baseline, drops malformed ones', () => {
    const w = restoreWorkspace({
      tabs: [
        { id: 'a', request: {}, source: { collectionId: 'c', requestId: 'r', extra: 1 }, baseline: 'sig' },
        { id: 'b', request: {}, source: { collectionId: 5, requestId: 'r' }, baseline: 42 },
        { id: 'c', request: {}, source: 'c/r' },
        { id: 'd', request: {}, source: null },
      ],
    });
    expect(w.tabs[0]!.source).toEqual({ collectionId: 'c', requestId: 'r' });
    expect(w.tabs[0]!.baseline).toBe('sig');
    expect(w.tabs[1]!.source).toBeUndefined();
    expect(w.tabs[1]!.baseline).toBeUndefined();
    expect(w.tabs[2]!.source).toBeUndefined();
    expect(w.tabs[3]!.source).toBeUndefined();
  });

  it('caps the number of tabs at MAX_TABS', () => {
    const tabs = Array.from({ length: MAX_TABS + 10 }, (_, i) => ({ id: `t${i}`, request: {} }));
    expect(restoreWorkspace({ tabs }).tabs).toHaveLength(MAX_TABS);
  });

  it('forces version 1 and drops unknown workspace and request fields', () => {
    const w = restoreWorkspace({ version: 99, extra: 'x', tabs: [{ id: 'a', request: { url: 'u', evil: '<script>' }, junk: true }] });
    expect(w.version).toBe(1);
    expect(Object.keys(w).sort()).toEqual(['activeTabId', 'tabs', 'version']);
    expect(Object.keys(w.tabs[0]!)).toEqual(['id', 'request']);
    expect('evil' in w.tabs[0]!.request).toBe(false);
  });

  it('never throws on malicious input and does not pollute prototypes', () => {
    const raw = JSON.parse(
      '{"__proto__":{"polluted":true},"tabs":[{"id":"a","__proto__":{"polluted":true},"request":{"method":"DELETE; DROP TABLE","url":"x","__proto__":{"polluted":true},"headers":[{"__proto__":{"polluted":true},"key":{"toString":"boom"}}]}}],"activeTabId":"a"}',
    );
    let w: Workspace | undefined;
    expect(() => { w = restoreWorkspace(raw); }).not.toThrow();
    expect(w!.tabs[0]!.request.method).toBe('GET');
    expect(w!.tabs[0]!.request.headers).toEqual([{ key: '', value: '', enabled: true }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('round-trips a serialized workspace', () => {
    let w = openRequest(newWorkspace(), withUrl('https://x.com', { id: 'r1' }), { collectionId: 'c', requestId: 'r1' });
    w = addTab(w, tab('scratch', withUrl('https://typed.com')));
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(w)));
    expect(restored).toEqual(w);
    expect(restored.tabs.map(isTabDirty)).toEqual([false, true]);
  });

  it('keeps a saved tab clean after restore even when its optional fields were added in a different order', () => {
    // The UI adds optional fields by spreading, so they end up after `auth` in whatever
    // order the user touched them: here form fields first, then a text content type.
    const r: ApiRequest = { ...newRequest(), url: 'https://x.com', bodyType: 'text', body: 'hi' };
    const edited: ApiRequest = { ...r, formFields: [{ key: 'a', value: '1', enabled: true }], textContentType: 'text/csv' };
    const w = markTabSaved(ws([tab('a', edited)]), 'a', { collectionId: 'c', requestId: r.id });
    expect(isTabDirty(w.tabs[0]!)).toBe(false);
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(w)));
    expect(restored.tabs[0]!.request).toEqual(edited);
    expect(isTabDirty(restored.tabs[0]!)).toBe(false);
  });
});
