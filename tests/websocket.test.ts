import { describe, expect, it } from 'vitest';
import {
  appendLog, checkJson, closeCodeLabel, describeClose, filterLog, formatLogTime, impliedWsScheme, logToText, methodLabel,
  newWebSocketRequest, parseProtocols, prepareMessage, resolveWebSocket, toHttpRequest, toWebSocketRequest, toWebSocketUrl,
  type WsLogEntry,
} from '../utils/websocket';
import { newRequest, type ApiRequest } from '../utils/request';
import { sanitizeCollection, sanitizeHistoryEntry, sanitizeRequest } from '../utils/sanitize';
import { restoreWorkspace, isBlankRequest, isTabDirty, newTab } from '../utils/workspace';
import { createBackup, parseBackup } from '../utils/backup';
import { exportToPostman } from '../utils/import-export';
import { filterHistory } from '../utils/history';
import { filterCollectionTree, newCollection, upsertRequest, findRequestAnywhere } from '../utils/collections';

const vars = [{ key: 'host', value: 'echo.example.com', enabled: true }, { key: 'tok', value: 'abc', enabled: true }];
const entry = (id: number, dir: WsLogEntry['dir'], text: string, kind: WsLogEntry['kind'] = 'text'): WsLogEntry => ({ id, at: 1_700_000_000_000, dir, kind, text, size: text.length });

describe('toWebSocketUrl', () => {
  it('accepts ws and wss', () => {
    expect(toWebSocketUrl('wss://api.example.com/socket?x=1')).toEqual({ ok: true, url: 'wss://api.example.com/socket?x=1' });
    expect(toWebSocketUrl('ws://localhost:8080')).toEqual({ ok: true, url: 'ws://localhost:8080/' });
  });
  it('defaults the scheme: ws for local hosts, wss otherwise', () => {
    expect(impliedWsScheme('localhost:3000/x')).toBe('ws');
    expect(impliedWsScheme('example.com')).toBe('wss');
    expect(impliedWsScheme('wss://x')).toBeNull();
    expect(toWebSocketUrl('example.com/chat')).toEqual({ ok: true, url: 'wss://example.com/chat' });
  });
  it('maps pasted http(s) URLs', () => {
    expect(toWebSocketUrl('https://example.com/a')).toEqual({ ok: true, url: 'wss://example.com/a' });
    expect(toWebSocketUrl('http://localhost/a')).toEqual({ ok: true, url: 'ws://localhost/a' });
  });
  it('refuses other schemes, empty and malformed input, and strips fragments', () => {
    expect(toWebSocketUrl('ftp://example.com')).toMatchObject({ ok: false });
    expect(toWebSocketUrl('  ')).toMatchObject({ ok: false });
    expect(toWebSocketUrl('wss://')).toMatchObject({ ok: false });
    expect(toWebSocketUrl('wss://a.com/x#frag')).toEqual({ ok: true, url: 'wss://a.com/x' });
  });
});

describe('parseProtocols', () => {
  it('splits on commas and spaces, dropping blanks and repeats', () => {
    expect(parseProtocols('graphql-ws, v1.json  graphql-ws,')).toEqual({ protocols: ['graphql-ws', 'v1.json'], invalid: [] });
    expect(parseProtocols('')).toEqual({ protocols: [], invalid: [] });
  });
  it('reports names the constructor would reject', () => {
    expect(parseProtocols('ok, bad(name), "q"')).toEqual({ protocols: ['ok'], invalid: ['bad(name)', '"q"'] });
  });
});

describe('resolveWebSocket', () => {
  it('interpolates the URL and subprotocols', () => {
    const req = { ...newWebSocketRequest(), url: 'wss://{{host}}/s?t={{tok}}', ws: { protocols: 'p1, {{tok}}', draft: '', draftFormat: 'text' as const, saved: [] } };
    expect(resolveWebSocket(req, vars)).toEqual({ resolved: { url: 'wss://echo.example.com/s?t=abc', protocols: ['p1', 'abc'] }, unresolved: [] });
  });
  it('lists undefined variables and fails on a bad subprotocol', () => {
    const req = { ...newWebSocketRequest(), url: 'wss://{{nope}}/s' };
    expect(resolveWebSocket(req, vars).unresolved).toEqual(['nope']);
    const bad = { ...newWebSocketRequest(), url: 'wss://a.com', ws: { protocols: 'a(b)', draft: '', draftFormat: 'text' as const, saved: [] } };
    expect(resolveWebSocket(bad, vars).error).toMatch(/subprotocol/);
  });
});

describe('messages', () => {
  it('validates and pretty-prints JSON', () => {
    expect(checkJson('{"a":1}')).toEqual({ ok: true, formatted: '{\n  "a": 1\n}' });
    expect(checkJson('{"a":')).toMatchObject({ ok: false });
    expect(checkJson('  ')).toMatchObject({ ok: false });
  });
  it('sends JSON as written once it parses, and refuses invalid JSON', () => {
    expect(prepareMessage('{"t": "{{tok}}"}', 'json', vars)).toEqual({ ok: true, text: '{"t": "abc"}' });
    expect(prepareMessage('{oops', 'json', vars)).toMatchObject({ ok: false });
    expect(prepareMessage('{oops', 'text', vars)).toEqual({ ok: true, text: '{oops' });
    expect(prepareMessage('', 'text', vars)).toMatchObject({ ok: false });
  });
});

describe('saved message names', () => {
  it('names a message after its content, JSON on one line', () => {
    expect(defaultMessageName('{\n  "type": "ping"\n}')).toBe('{"type":"ping"}');
    expect(defaultMessageName('hello\nworld')).toBe('hello');
    expect(defaultMessageName('x'.repeat(60))).toHaveLength(40);
    expect(defaultMessageName('  ')).toBe('Message');
  });
});

describe('log', () => {
  it('caps the log and says how many entries fell off', () => {
    const log = [entry(1, 'sent', 'a'), entry(2, 'received', 'b')];
    expect(appendLog(log, [entry(3, 'sent', 'c')], 2)).toEqual({ log: [log[1], entry(3, 'sent', 'c')], dropped: 1 });
    expect(appendLog(log, [], 5).dropped).toBe(0);
  });
  it('filters by direction and text', () => {
    const log = [entry(1, 'sent', 'Hello'), entry(2, 'received', 'hello back'), entry(3, 'system', 'Connected', 'open')];
    expect(filterLog(log, { query: 'HELLO' }).map((e) => e.id)).toEqual([1, 2]);
    expect(filterLog(log, { dir: 'received' }).map((e) => e.id)).toEqual([2]);
    expect(filterLog(log, { dir: 'messages' }).map((e) => e.id)).toEqual([1, 2]);
    expect(filterLog(log, { dir: 'system', query: 'conn' }).map((e) => e.id)).toEqual([3]);
    expect(filterLog(log, {})).toHaveLength(3);
  });
  it('formats time with milliseconds and exports plain text', () => {
    expect(formatLogTime(new Date(2024, 0, 2, 3, 4, 5, 6).getTime())).toBe('03:04:05.006');
    const text = logToText([entry(1, 'sent', 'hi'), entry(2, 'received', '{\n  "a": 1\n}')]);
    expect(text).toMatch(/Sent: hi\n/);
    expect(text).toMatch(/Received\n\{/);
  });
  it('names close codes', () => {
    expect(closeCodeLabel(1006)).toMatch(/abnormal/);
    expect(closeCodeLabel(4001)).toMatch(/application/);
    expect(describeClose(1000, '', true)).toBe('Closed with code 1000 (normal closure)');
    expect(describeClose(1006, '', false)).toMatch(/did not end with a close handshake/);
  });
});

describe('request kinds', () => {
  it('labels WebSocket requests WS', () => {
    expect(methodLabel(newWebSocketRequest())).toBe('WS');
    expect(methodLabel(newRequest())).toBe('GET');
  });
  it('converts both ways, mapping the URL scheme', () => {
    const http: ApiRequest = { ...newRequest(), url: 'https://a.com/x' };
    const ws = toWebSocketRequest(http);
    expect(ws).toMatchObject({ kind: 'websocket', url: 'wss://a.com/x', method: 'GET' });
    const back = toHttpRequest(ws);
    expect(back.kind).toBeUndefined();
    expect(back.ws).toBeUndefined();
    expect(back.url).toBe('https://a.com/x');
  });
  it('treats an empty WebSocket tab as blank and one with a message as dirty', () => {
    const req = newWebSocketRequest();
    expect(isBlankRequest(req)).toBe(true);
    expect(isTabDirty(newTab(req))).toBe(false);
    expect(isTabDirty(newTab({ ...req, ws: { ...req.ws!, draft: 'hi' } }))).toBe(true);
  });
});

describe('storage format: backward compatible, with a migration', () => {
  // Written by 0.6.x, before WebSocket support: no `kind`, no `ws`.
  const legacyRequest = {
    id: 'r1', name: 'Get users', method: 'POST', url: 'https://api.example.com/users', headers: [{ key: 'X-A', value: '1', enabled: true }],
    params: [], body: '{"a":1}', bodyType: 'json', auth: { type: 'bearer', token: 't' },
  };
  const legacyStorage = {
    workspace: { version: 1, tabs: [{ id: 't1', request: legacyRequest }], activeTabId: 't1' },
    collections: [{ id: 'c1', name: 'API', description: '', requests: [legacyRequest], created: 1, updated: 2 }],
    history: [{ id: 'h1', request: legacyRequest, response: { status: 200, statusText: 'OK', headers: {}, body: '', size: 0, time: 5, contentType: '' }, timestamp: 9 }],
  };

  it('loads every pre-existing request as an unchanged HTTP request', () => {
    const req = sanitizeRequest(legacyRequest)!;
    expect(req.kind).toBeUndefined();
    expect(req.ws).toBeUndefined();
    expect(req).toMatchObject({ id: 'r1', method: 'POST', bodyType: 'json', url: 'https://api.example.com/users' });
    expect('kind' in req || 'ws' in req).toBe(false);
    expect(restoreWorkspace(legacyStorage.workspace).tabs[0]!.request).toEqual(req);
    expect(sanitizeCollection(legacyStorage.collections[0])!.requests[0]).toEqual(req);
    expect(sanitizeHistoryEntry(legacyStorage.history[0])!.request).toEqual(req);
  });

  it('keeps a legacy request byte-identical through a re-save', () => {
    const once = sanitizeRequest(legacyRequest)!;
    expect(JSON.parse(JSON.stringify(sanitizeRequest(once)))).toEqual(JSON.parse(JSON.stringify(once)));
  });

  it('round-trips a WebSocket request through collections, history, workspace and backup', () => {
    const ws = {
      ...newWebSocketRequest('Echo'), id: 'w1', url: 'wss://echo.example.com',
      ws: { protocols: 'graphql-ws', draft: '{"x":1}', draftFormat: 'json' as const, saved: [{ id: 's1', name: 'ping', format: 'text' as const, text: 'ping' }] },
    };
    const collection = upsertRequest({ ...newCollection('Mixed'), id: 'c9' }, ws, null);
    const entryOut = { id: 'h2', request: ws, response: { status: 101, statusText: 'Connected', headers: {}, body: '', size: 0, time: 1, contentType: '' }, timestamp: 5 };
    const storage = { collections: [collection], history: [entryOut], workspace: { version: 1, tabs: [{ id: 't', request: ws }], activeTabId: 't' } };

    expect(sanitizeCollection(JSON.parse(JSON.stringify(collection)))!.requests[0]).toEqual(ws);
    expect(sanitizeHistoryEntry(JSON.parse(JSON.stringify(entryOut)))!.request).toEqual(ws);
    expect(restoreWorkspace(JSON.parse(JSON.stringify(storage.workspace))).tabs[0]!.request).toEqual(ws);

    const parsed = parseBackup(JSON.stringify(createBackup(storage)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(findRequestAnywhere(parsed.data.collections![0]!, 'w1')).toEqual(ws);
  });

  it('repairs a damaged ws member instead of dropping the request', () => {
    const req = sanitizeRequest({ ...legacyRequest, kind: 'websocket', ws: { protocols: 5, draftFormat: 'xml', saved: [{ name: 7 }, 'junk', null] } })!;
    expect(req.kind).toBe('websocket');
    expect(req.ws).toMatchObject({ protocols: '5', draft: '', draftFormat: 'text' });
    expect(req.ws!.saved).toHaveLength(1);
    expect(req.ws!.saved[0]).toMatchObject({ name: '7', format: 'text', text: '' });
    expect(sanitizeRequest({ ...legacyRequest, kind: 'websocket' })!.ws).toEqual({ protocols: '', draft: '', draftFormat: 'text', saved: [] });
  });

  it('ignores an unknown kind and a stray ws on an HTTP request', () => {
    const req = sanitizeRequest({ ...legacyRequest, kind: 'grpc', ws: { draft: 'x' } })!;
    expect(req.kind).toBeUndefined();
    expect(req.ws).toBeUndefined();
  });
});

describe('WebSocket requests next to HTTP ones', () => {
  const ws = { ...newWebSocketRequest('Echo'), id: 'w1', url: 'wss://echo.example.com' };
  const http = { ...newRequest('List'), id: 'h1', url: 'https://api.example.com/list' };

  it('leaves them out of a Postman export', () => {
    const c = upsertRequest(upsertRequest({ ...newCollection('Mixed'), id: 'c' }, http, null), ws, null);
    const out = JSON.parse(exportToPostman(c));
    expect(out.item.map((i: { name: string }) => i.name)).toEqual(['List']);
  });

  it('filters history and collections by the WS label', () => {
    const entries = [ws, http].map((request, i) => ({ id: String(i), request, response: { status: 0, statusText: '', headers: {}, body: '', size: 0, time: 0, contentType: '' }, timestamp: i }));
    expect(filterHistory(entries, { method: 'WS' }).map((e) => e.request.id)).toEqual(['w1']);
    expect(filterHistory(entries, { method: 'GET' }).map((e) => e.request.id)).toEqual(['h1']);
    const c = upsertRequest(upsertRequest({ ...newCollection('Mixed'), id: 'c' }, http, null), ws, null);
    expect(filterCollectionTree([c], 'ws')[0]!.requests.map((r) => r.id)).toEqual(['w1']);
  });
});
