import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { newRequest, type ApiRequest, type ResolvedRequest } from '../utils/request';
import { newWorkspace, newTab } from '../utils/workspace';

// IndexedDB and webRequest don't exist in Node: stand in for them.
const files = new Map<string, Blob>();
const stored = new Map<string, unknown>();
vi.mock('@/utils/idb', () => ({
  idbGet: vi.fn(async (_store: string, key: string) => files.get(key)),
  idbPut: vi.fn(async (_store: string, key: string, value: unknown) => void stored.set(key, value)),
  idbDelete: vi.fn(async () => undefined),
}));
vi.mock('../entrypoints/app/network', () => ({
  startNetworkObserver: vi.fn(async () => false),
  beginTrace: vi.fn(() => ({})),
  endTrace: vi.fn(async () => ({ hops: [], cookies: undefined, errorCode: undefined })),
}));
vi.mock('@/utils/review-nudge', () => ({
  closeReviewNudgeWindow: vi.fn(),
  recordRequestAnswered: vi.fn(async () => undefined),
}));

const { executeResolved, failureOf, sendTab, cancelSend } = await import('../entrypoints/app/send');
const store = await import('../entrypoints/app/store');
const network = await import('../entrypoints/app/network');
const nudge = await import('@/utils/review-nudge');

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<FetchImpl>>;
function mockFetch(impl: FetchImpl) {
  fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
}
const lastInit = () => fetchMock.mock.calls.at(-1)![1];

function resolved(partial: Partial<ResolvedRequest> = {}): ResolvedRequest {
  return { method: 'GET', url: 'https://api.example.com/items', headers: [], body: { kind: 'none' }, ...partial };
}
const opts = () => ({ signal: new AbortController().signal, sendCookies: false });

beforeEach(() => {
  fakeBrowser.reset();
  files.clear();
  stored.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('executeResolved — what fetch() is given', () => {
  it('never attaches the browser cookies unless the request opts in', async () => {
    mockFetch(async () => new Response('ok'));
    await executeResolved(resolved(), opts());
    expect(lastInit()).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow' });

    await executeResolved(resolved(), { ...opts(), sendCookies: true });
    expect(lastInit().credentials).toBe('include');
  });

  it('passes headers in order, repeats included, and the text body as is', async () => {
    mockFetch(async () => new Response('ok'));
    const headers: Array<[string, string]> = [['X-A', '1'], ['X-A', '2'], ['Content-Type', 'application/json']];
    await executeResolved(resolved({ method: 'POST', headers, body: { kind: 'text', text: '{"a":1}' } }), opts());
    expect(lastInit().headers).toEqual(headers);
    expect(lastInit().body).toBe('{"a":1}');
  });

  it('encodes x-www-form-urlencoded fields', async () => {
    mockFetch(async () => new Response('ok'));
    await executeResolved(resolved({ method: 'POST', body: { kind: 'urlencoded', fields: [['q', 'a b'], ['x', '&=']] } }), opts());
    expect(String(lastInit().body)).toBe('q=a+b&x=%26%3D');
  });

  it('builds multipart bodies from text fields and files kept in IndexedDB', async () => {
    mockFetch(async () => new Response('ok'));
    files.set('f1', new Blob(['PNGDATA'], { type: 'image/png' }));
    const file = { id: 'f1', name: 'pic.png', size: 7, type: 'image/png' };
    await executeResolved(
      resolved({ method: 'POST', body: { kind: 'multipart', fields: [{ name: 'title', value: 'hi' }, { name: 'upload', file }] } }),
      opts(),
    );
    const form = lastInit().body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('title')).toBe('hi');
    const part = form.get('upload') as File;
    expect(part.name).toBe('pic.png');
    expect(await part.text()).toBe('PNGDATA');
  });

  it('sends a binary file body from IndexedDB, and fails by name when it is gone', async () => {
    mockFetch(async () => new Response('ok'));
    files.set('bin', new Blob([new Uint8Array([1, 2, 3])]));
    await executeResolved(resolved({ method: 'PUT', body: { kind: 'binary', file: { id: 'bin', name: 'a.bin', size: 3, type: '' } } }), opts());
    expect(new Uint8Array(await (lastInit().body as Blob).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const missing = resolved({ method: 'PUT', body: { kind: 'binary', file: { id: 'gone', name: 'old.bin', size: 3, type: '' } } });
    const err = await executeResolved(missing, opts()).catch((e) => e);
    expect(err.message).toContain('old.bin');
    expect(failureOf(err, false, missing.url).detail).toContain('old.bin');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('executeResolved — reading the response', () => {
  it('returns status, headers, decoded JSON text and sizes', async () => {
    mockFetch(async () => new Response('{"name":"café"}', { status: 201, statusText: 'Created', headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Id': '7' } }));
    const r = await executeResolved(resolved({ method: 'POST' }), opts());
    expect(r).toMatchObject({ status: 201, statusText: 'Created', kind: 'json', text: '{"name":"café"}', method: 'POST', requestUrl: 'https://api.example.com/items' });
    expect(r.url).toBe('https://api.example.com/items');
    expect(r.size).toBe(new TextEncoder().encode('{"name":"café"}').byteLength);
    expect(r.headers).toContainEqual(['x-id', '7']);
    expect(r.time).toBeGreaterThanOrEqual(0);
  });

  it('keeps binary responses as bytes without text', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    mockFetch(async () => new Response(png, { headers: { 'Content-Type': 'image/png' } }));
    const r = await executeResolved(resolved(), opts());
    expect(r.kind).toBe('image');
    expect(r.text).toBeUndefined();
    expect(r.bytes).toEqual(png);
  });

  it('turns an elapsed request timeout into a timeout failure, not a cancel', async () => {
    mockFetch((_url, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))));
    const err = await executeResolved(resolved(), { ...opts(), timeoutMs: 20 }).catch((e) => e);
    const failure = failureOf(err, false, 'https://api.example.com/items');
    expect(failure.title).toMatch(/timed out/i);
  });

  it('streams Server-Sent Events to onEvents and returns every event', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: one\n\n'));
        c.enqueue(enc.encode('event: tick\ndata: two\n\n'));
        c.close();
      },
    });
    mockFetch(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    const onEvents = vi.fn();
    const r = await executeResolved(resolved(), { ...opts(), onEvents });
    expect(onEvents).toHaveBeenCalled();
    expect(r.kind).toBe('text');
    expect(r.events!.map((e) => [e.event, e.data])).toEqual([['message', 'one'], ['tick', 'two']]);
    expect(r.streamStopped).toBe(false);
  });
});

describe('failureOf', () => {
  it('names a header the browser refused to send', () => {
    const f = failureOf(new TypeError("Invalid header value 'a\nb'"), false, 'https://x.test/');
    expect(f.title).toBe('A header can’t be sent');
  });

  it('says "cancelled" when the user stopped it, even if the network reported ERR_ABORTED', () => {
    expect(failureOf(new DOMException('aborted', 'AbortError'), true, 'https://x.test/', 'net::ERR_ABORTED').title).toMatch(/cancel/i);
  });

  it('prefers the network error code over fetch()’s generic TypeError', () => {
    const f = failureOf(new TypeError('Failed to fetch'), false, 'https://nope.invalid/', 'net::ERR_NAME_NOT_RESOLVED');
    expect(f.detail).toContain('nope.invalid');
    expect(f.title).not.toBe(failureOf(new TypeError('Failed to fetch'), false, 'https://nope.invalid/').title);
  });
});

describe('sendTab — one click of Send', () => {
  let history: unknown[];

  function openTab(request: ApiRequest): string {
    const ws = newWorkspace();
    const tab = newTab(request);
    ws.tabs = [tab];
    ws.activeTabId = tab.id;
    store.setState((s) => ({ ...s, workspace: ws, runs: {}, environments: [], activeEnvId: null, requestTimeout: 0, welcomed: false }));
    return tab.id;
  }

  beforeEach(() => {
    history = [];
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.action === 'addHistory') history.push(msg.entry);
    });
  });

  it('adds a scheme, sends, stores the result, runs tests and records history', async () => {
    mockFetch(async () => new Response('{"id":42}', { headers: { 'Content-Type': 'application/json' } }));
    const request = {
      ...newRequest('Get item'),
      url: 'api.example.com/items/1',
      assertions: [{ id: 'a1', enabled: true, source: 'status' as const, path: '', op: 'equals' as const, expected: '200' }],
    };
    const tabId = openTab(request);

    await sendTab(tabId);

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/items/1');
    expect(store.findTab(tabId)!.request.url).toBe('https://api.example.com/items/1');
    const run = store.getState().runs[tabId]!;
    expect(run.state).toBe('done');
    expect(run.response!.text).toBe('{"id":42}');
    expect(run.tests).toEqual([expect.objectContaining({ id: 'a1', pass: true })]);
    expect(store.getState().welcomed).toBe(true);
    expect(stored.get(tabId)).toBe(run.response);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ request: { url: 'https://api.example.com/items/1' }, response: { status: 200, body: '{"id":42}' } });
    expect(nudge.closeReviewNudgeWindow).toHaveBeenCalled();
    expect(nudge.recordRequestAnswered).toHaveBeenCalledTimes(1);
    expect(network.endTrace).toHaveBeenCalledTimes(1);
  });

  it('writes extracted values into the active environment', async () => {
    mockFetch(async () => new Response('{"token":"abc"}', { headers: { 'Content-Type': 'application/json' } }));
    const tabId = openTab({
      ...newRequest(),
      url: 'https://api.example.com/login',
      extractions: [{ id: 'x1', enabled: true, source: 'jsonpath', path: '$.token', variable: 'token' }],
    });
    store.setState((s) => ({ ...s, environments: [{ id: 'env', name: 'Dev', variables: [] }], activeEnvId: 'env' }));

    await sendTab(tabId);

    expect(store.getState().runs[tabId]!.extractNote).toBe('Saved to “Dev”.');
    expect(store.getState().environments[0]!.variables).toContainEqual(expect.objectContaining({ key: 'token', value: 'abc', enabled: true }));
    expect(await fakeBrowser.storage.local.get('environments')).toMatchObject({ environments: [{ id: 'env' }] });
  });

  it('records a failed request in history with status 0 and keeps the previous response on screen', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const tabId = openTab({ ...newRequest(), url: 'https://down.example.com/' });
    const previous = { status: 200 } as never;
    store.setRun(tabId, { state: 'done', response: previous, warnings: [] });

    await sendTab(tabId);

    const run = store.getState().runs[tabId]!;
    expect(run.state).toBe('error');
    expect(run.response).toBe(previous);
    expect(history).toEqual([expect.objectContaining({ response: expect.objectContaining({ status: 0, statusText: run.error!.title }) })]);
    expect(nudge.recordRequestAnswered).not.toHaveBeenCalled();
  });

  it('does not record a cancelled request in history', async () => {
    mockFetch((_url, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const tabId = openTab({ ...newRequest(), url: 'https://slow.example.com/' });

    const sending = sendTab(tabId);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    cancelSend(tabId);
    await sending;

    expect(store.getState().runs[tabId]!.state).toBe('error');
    expect(store.getState().runs[tabId]!.error!.title).toMatch(/cancel/i);
    expect(history).toEqual([]);
  });

  it('ignores a second Send while the first is in flight', async () => {
    let finish!: () => void;
    mockFetch(() => new Promise((resolve) => (finish = () => resolve(new Response('ok')))));
    const tabId = openTab({ ...newRequest(), url: 'https://api.example.com/' });

    const first = sendTab(tabId);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await sendTab(tabId);
    finish();
    await first;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to send a request that cannot be resolved, without calling fetch', async () => {
    mockFetch(async () => new Response('ok'));
    const tabId = openTab({ ...newRequest(), url: '' });

    await sendTab(tabId);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().runs[tabId]!).toMatchObject({ state: 'error', error: { title: 'This request can’t be sent yet' } });
    expect(history).toEqual([]);
  });
});
