import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { newWebSocketRequest } from '../utils/websocket';
import { newWorkspace, newTab } from '../utils/workspace';

vi.mock('@/utils/idb', () => ({ idbGet: vi.fn(async () => undefined), idbPut: vi.fn(async () => undefined), idbDelete: vi.fn(async () => undefined) }));
vi.mock('../entrypoints/app/network', () => ({ startNetworkObserver: vi.fn(async () => false) }));

class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  protocols?: string | string[];
  protocol = '';
  binaryType = 'blob';
  sent: string[] = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeSocket.instances.push(this);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close(code?: number) {
    this.closedWith = code;
    queueMicrotask(() => this.onclose?.({ code: code ?? 1005, reason: '', wasClean: true }));
  }
  // test helpers
  open(protocol = '') {
    this.protocol = protocol;
    this.onopen?.();
  }
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}

const store = await import('../entrypoints/app/store');
const ws = await import('../entrypoints/app/websocket');

function openTab(patch: Partial<ReturnType<typeof newWebSocketRequest>> = {}) {
  const tab = newTab({ ...newWebSocketRequest('Echo'), url: 'wss://echo.example.com/s', ...patch });
  store.setState((s) => ({ ...s, ready: true, workspace: { ...newWorkspace(), tabs: [tab], activeTabId: tab.id } }));
  return tab.id;
}
const session = (id: string) => store.getState().wsSessions[id]!;
const texts = (id: string) => session(id).log.map((e) => `${e.dir}:${e.kind}:${e.text}`);

beforeEach(() => {
  fakeBrowser.reset();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.useFakeTimers();
  store.setState((s) => ({ ...s, wsSessions: {}, environments: [], activeEnvId: null }));
});
afterEach(() => {
  for (const id of Object.keys(store.getState().wsSessions)) ws.discardWs(id);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WebSocket connection', () => {
  it('connects, offering subprotocols, and logs the open event', () => {
    const id = openTab({ ws: { protocols: 'graphql-ws, v1', draft: '', draftFormat: 'text', saved: [] } });
    ws.connectWs(id);
    expect(session(id).state).toBe('connecting');
    expect(FakeSocket.instances[0]).toMatchObject({ url: 'wss://echo.example.com/s', protocols: ['graphql-ws', 'v1'], binaryType: 'arraybuffer' });
    FakeSocket.instances[0]!.open('v1');
    expect(session(id)).toMatchObject({ state: 'open', protocol: 'v1' });
    expect(texts(id).at(-1)).toBe('system:open:Connected, subprotocol: v1');
  });

  it('does not open a second socket while one is live', () => {
    const id = openTab();
    ws.connectWs(id);
    ws.connectWs(id);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('reports a bad URL or subprotocol without opening a socket', () => {
    const id = openTab({ url: 'ftp://x' });
    ws.connectWs(id);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(session(id)).toMatchObject({ state: 'closed' });
    expect(session(id).error).toMatch(/ws:\/\//);
    store.updateRequest(id, (r) => ({ ...r, url: 'wss://a.com', ws: { ...r.ws!, protocols: 'a(b)' } }));
    ws.connectWs(id);
    expect(session(id).error).toMatch(/subprotocol/);
  });

  it('interpolates environment variables into the URL', () => {
    const id = openTab({ url: 'wss://{{host}}/s' });
    store.setState((s) => ({ ...s, environments: [{ id: 'e', name: 'E', variables: [{ key: 'host', value: 'h.example.com', enabled: true }] }], activeEnvId: 'e' }));
    ws.connectWs(id);
    expect(FakeSocket.instances[0]!.url).toBe('wss://h.example.com/s');
  });

  it('shows the failure and then closed when the handshake fails', () => {
    const id = openTab();
    ws.connectWs(id);
    const sock = FakeSocket.instances[0]!;
    sock.onerror?.();
    sock.onclose?.({ code: 1006, reason: '', wasClean: false });
    expect(session(id)).toMatchObject({ state: 'closed', closeCode: 1006 });
    expect(texts(id).join('\n')).toMatch(/connection failed/);
    expect(texts(id).at(-1)).toMatch(/code 1006/);
  });
});

describe('sending and receiving', () => {
  function connected() {
    const id = openTab();
    ws.connectWs(id);
    FakeSocket.instances[0]!.open();
    return { id, sock: FakeSocket.instances[0]! };
  }

  it('sends text and logs it with direction and size', () => {
    const { id, sock } = connected();
    expect(ws.sendWs(id, 'héllo', 'text')).toEqual({ ok: true });
    expect(sock.sent).toEqual(['héllo']);
    vi.advanceTimersByTime(100);
    const last = session(id).log.at(-1)!;
    expect(last).toMatchObject({ dir: 'sent', kind: 'text', text: 'héllo', size: 6 });
    expect(session(id).sent).toBe(1);
  });

  it('refuses invalid JSON and sends nothing', () => {
    const { id, sock } = connected();
    const out = ws.sendWs(id, '{"a":', 'json');
    expect(out).toMatchObject({ ok: false });
    expect(sock.sent).toEqual([]);
  });

  it('refuses to send when not open', () => {
    const id = openTab();
    expect(ws.sendWs(id, 'x', 'text')).toMatchObject({ ok: false });
    ws.connectWs(id);
    expect(ws.sendWs(id, 'x', 'text')).toMatchObject({ ok: false });
  });

  it('logs text and binary messages, batching renders', () => {
    const { id, sock } = connected();
    const before = session(id).log.length;
    sock.receive('one');
    sock.receive(new Uint8Array([1, 2, 255]).buffer);
    expect(session(id).log).toHaveLength(before); // not yet rendered
    vi.advanceTimersByTime(60);
    expect(session(id).received).toBe(2);
    const [text, bin] = session(id).log.slice(-2);
    expect(text).toMatchObject({ dir: 'received', kind: 'text', text: 'one' });
    expect(bin).toMatchObject({ kind: 'binary', size: 3 });
    expect(bin!.text).toMatch(/01 02 ff/);
  });

  it('ignores events from a socket that is no longer current', () => {
    const { id, sock } = connected();
    ws.discardWs(id);
    sock.receive('late');
    expect(store.getState().wsSessions[id]).toBeUndefined();
  });
});

describe('disconnecting, clearing and history', () => {
  it('disconnects with a normal close and keeps the log for the next connection', async () => {
    const id = openTab();
    ws.connectWs(id);
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.receive('keep me');
    ws.disconnectWs(id);
    expect(session(id).state).toBe('closing');
    await vi.advanceTimersByTimeAsync(10);
    expect(sock.closedWith).toBe(1000);
    expect(session(id)).toMatchObject({ state: 'closed', closeCode: 1000 });
    ws.connectWs(id);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(texts(id)).toContain('received:text:keep me');
  });

  it('clears the log, including entries not yet rendered', () => {
    const id = openTab();
    ws.connectWs(id);
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.receive('pending');
    ws.clearWsLog(id);
    vi.advanceTimersByTime(100);
    expect(session(id).log).toEqual([]);
  });

  it('records one history entry per connection, without the log', async () => {
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(true as never);
    const id = openTab({ ws: { protocols: '', draft: 'hi', draftFormat: 'text', saved: [{ id: 's', name: 'n', format: 'text', text: 'x' }] } });
    ws.connectWs(id);
    FakeSocket.instances[0]!.open();
    ws.sendWs(id, 'a', 'text');
    FakeSocket.instances[0]!.receive('b');
    ws.disconnectWs(id);
    await vi.advanceTimersByTimeAsync(100);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const { action, entry } = sendMessage.mock.calls[0]![0] as unknown as { action: string; entry: { request: { kind: string; ws: { saved: unknown[] } }; response: { status: number; statusText: string } } };
    expect(action).toBe('addHistory');
    expect(entry.request).toMatchObject({ kind: 'websocket', ws: { saved: [expect.anything()] } });
    expect(entry.response).toMatchObject({ status: 101, statusText: 'Connected · 1 sent, 1 received' });
    expect(JSON.stringify(entry)).not.toContain('"log"');
  });

  it('records a failed connection as status 0', () => {
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(true as never);
    const id = openTab();
    ws.connectWs(id);
    FakeSocket.instances[0]!.onclose?.({ code: 1006, reason: '', wasClean: false });
    expect((sendMessage.mock.calls[0]![0] as unknown as { entry: { response: { status: number } } }).entry.response.status).toBe(0);
  });

  it('primaryWsAction connects when idle and sends the draft when open', () => {
    const id = openTab({ ws: { protocols: '', draft: 'ping', draftFormat: 'text', saved: [] } });
    ws.primaryWsAction(id);
    expect(FakeSocket.instances).toHaveLength(1);
    FakeSocket.instances[0]!.open();
    ws.primaryWsAction(id);
    expect(FakeSocket.instances[0]!.sent).toEqual(['ping']);
    expect(ws.hasLiveSocket()).toBe(true);
    ws.discardWs(id);
    expect(ws.hasLiveSocket()).toBe(false);
  });
});
