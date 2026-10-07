/**
 * WebSocket connections, opened from the app page like every other request. A page cannot
 * set WebSocket handshake headers, and this one does not pretend to: only the URL and the
 * subprotocols are sent. Each tab holds at most one socket; its log lives in memory.
 */

import { browser } from 'wxt/browser';
import { generateId } from '@/utils/request';
import {
  appendLog,
  clipLogText,
  describeClose,
  prepareMessage,
  resolveWebSocket,
  utf8Size,
  wsConfig,
  type WsLogEntry,
} from '@/utils/websocket';
import { hexDump } from '@/utils/response';
import { activeVariables, findTab, getState, markWelcomed, setWsSession, showToast } from './store';
import type { WsSession } from './types';
import { t } from '@/utils/i18n';

interface Live {
  socket: WebSocket;
  pending: WsLogEntry[];
  timer?: ReturnType<typeof setTimeout>;
  /** History is written once per connection. */
  recorded: boolean;
}

const live = new Map<string, Live>();
let entrySeq = 0;
/** Chatty sockets are rendered at most this often. */
const FLUSH_MS = 40;

function entry(kind: WsLogEntry['kind'], dir: WsLogEntry['dir'], text: string, size = 0): WsLogEntry {
  return { id: ++entrySeq, at: Date.now(), dir, kind, text, size };
}

function session(tabId: string): WsSession | undefined {
  return getState().wsSessions[tabId];
}

function patch(tabId: string, fn: (s: WsSession) => WsSession): void {
  const current = session(tabId);
  if (current) setWsSession(tabId, fn(current));
}

function flush(tabId: string): void {
  const l = live.get(tabId);
  if (!l) return;
  clearTimeout(l.timer);
  l.timer = undefined;
  if (l.pending.length === 0) return;
  const added = l.pending;
  l.pending = [];
  patch(tabId, (s) => {
    const next = appendLog(s.log, added);
    return {
      ...s,
      log: next.log,
      dropped: s.dropped + next.dropped,
      sent: s.sent + added.filter((e) => e.dir === 'sent' && e.kind !== 'info').length,
      received: s.received + added.filter((e) => e.dir === 'received').length,
    };
  });
}

/** Queue a log entry. Messages are batched; connection events show at once. */
function log(tabId: string, e: WsLogEntry): void {
  const l = live.get(tabId);
  if (!l) return;
  l.pending.push(e);
  if (e.dir === 'system') flush(tabId);
  else if (!l.timer) l.timer = setTimeout(() => flush(tabId), FLUSH_MS);
}

/** Connect the tab's WebSocket request. Does nothing while a connection is already up. */
export function connectWs(tabId: string): void {
  const tab = findTab(tabId);
  const existing = session(tabId);
  if (!tab || tab.request.kind !== 'websocket') return;
  if (existing && existing.state !== 'closed') return;
  markWelcomed();

  const previous = existing?.log ?? [];
  const startedAt = Date.now();
  const base: WsSession = { state: 'closed', url: '', protocol: '', log: previous, dropped: existing?.dropped ?? 0, sent: 0, received: 0, startedAt };
  const { resolved, error } = resolveWebSocket(tab.request, activeVariables());
  if (!resolved) {
    setWsSession(tabId, { ...base, error, log: appendLog(previous, [entry('error', 'system', error ?? '')]).log });
    return;
  }

  let socket: WebSocket;
  try {
    socket = resolved.protocols.length ? new WebSocket(resolved.url, resolved.protocols) : new WebSocket(resolved.url);
  } catch (e) {
    // The constructor throws for what only it can judge (a blocked port, say).
    const message = (e as Error).message || t('wsErrorCannotOpen');
    setWsSession(tabId, { ...base, url: resolved.url, error: message, log: appendLog(previous, [entry('error', 'system', message)]).log });
    return;
  }
  socket.binaryType = 'arraybuffer';
  const l: Live = { socket, pending: [], recorded: false };
  live.set(tabId, l);
  const offered = resolved.protocols.length ? ` (${t('wsOfferingProtocols', resolved.protocols.join(', '))})` : '';
  setWsSession(tabId, {
    ...base,
    state: 'connecting',
    url: resolved.url,
    log: appendLog(previous, [entry('info', 'system', `${t('wsLogConnecting', resolved.url)}${offered}`)]).log,
  });

  const current = () => live.get(tabId)?.socket === socket;

  socket.onopen = () => {
    if (!current()) return;
    flush(tabId);
    patch(tabId, (s) => ({ ...s, state: 'open', protocol: socket.protocol, openedAt: Date.now() }));
    log(tabId, entry('open', 'system', socket.protocol ? t('wsLogConnectedProtocol', socket.protocol) : t('wsLogConnected')));
  };

  socket.onmessage = (ev: MessageEvent) => {
    if (!current()) return;
    if (typeof ev.data === 'string') {
      log(tabId, entry('text', 'received', clipLogText(ev.data), utf8Size(ev.data)));
    } else {
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      log(tabId, entry('binary', 'received', `${t('wsBinaryMessage', bytes.byteLength)}\n${hexDump(bytes, 256)}`, bytes.byteLength));
    }
  };

  socket.onerror = () => {
    if (!current()) return;
    // Browsers deliberately say nothing about why; the close event follows.
    const opened = session(tabId)?.state === 'open';
    log(tabId, entry('error', 'system', opened ? t('wsLogErrorOpen') : t('wsLogErrorConnect')));
  };

  socket.onclose = (ev: CloseEvent) => {
    if (!current()) return;
    log(tabId, entry('close', 'system', describeClose(ev.code, ev.reason, ev.wasClean)));
    flush(tabId);
    live.delete(tabId);
    patch(tabId, (s) => ({ ...s, state: 'closed', closeCode: ev.code }));
    recordHistory(tabId, l);
  };
}

/** Close the connection (or abandon one still being made). */
export function disconnectWs(tabId: string): void {
  const l = live.get(tabId);
  if (!l) return;
  const s = session(tabId);
  if (s?.state === 'closing') return;
  patch(tabId, (x) => ({ ...x, state: 'closing' }));
  try {
    l.socket.close(1000);
  } catch {
    // already closing
  }
}

/** Closing a tab drops its socket without waiting for the close handshake. */
export function discardWs(tabId: string): void {
  const l = live.get(tabId);
  if (!l) return;
  live.delete(tabId);
  clearTimeout(l.timer);
  l.socket.onopen = l.socket.onmessage = l.socket.onerror = l.socket.onclose = null;
  try {
    l.socket.close(1000);
  } catch {
    // nothing to close
  }
  recordHistory(tabId, l);
  setWsSession(tabId, null);
}

export type SendOutcome = { ok: true } | { ok: false; error: string };

/** Send text over the open connection and log it. JSON-format messages must parse first. */
export function sendWs(tabId: string, text: string, format: 'text' | 'json'): SendOutcome {
  const l = live.get(tabId);
  if (!l || session(tabId)?.state !== 'open') return { ok: false, error: t('wsErrorNotConnected') };
  const prepared = prepareMessage(text, format, activeVariables());
  if (!prepared.ok) return { ok: false, error: prepared.error };
  try {
    l.socket.send(prepared.text);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  log(tabId, entry('text', 'sent', clipLogText(prepared.text), utf8Size(prepared.text)));
  return { ok: true };
}

/** Ctrl/Cmd+Enter: connect when there is no connection, send the composer's message when open. */
export function primaryWsAction(tabId: string): void {
  const tab = findTab(tabId);
  if (!tab || tab.request.kind !== 'websocket') return;
  const state = session(tabId)?.state;
  if (state === 'open') {
    const cfg = wsConfig(tab.request);
    const out = sendWs(tabId, cfg.draft, cfg.draftFormat);
    if (!out.ok) showToast(out.error);
  } else if (!state || state === 'closed') {
    connectWs(tabId);
  }
}

export function clearWsLog(tabId: string): void {
  const l = live.get(tabId);
  if (l) {
    clearTimeout(l.timer);
    l.timer = undefined;
    l.pending = [];
  }
  patch(tabId, (s) => ({ ...s, log: [], dropped: 0 }));
}

/** True while a socket is connecting, open or closing (the page should not unload silently). */
export function hasLiveSocket(): boolean {
  return live.size > 0;
}

/** One history entry per connection, so a WebSocket request can be reopened from History. */
function recordHistory(tabId: string, l: Live): void {
  if (l.recorded) return;
  l.recorded = true;
  const tab = findTab(tabId);
  const s = session(tabId);
  if (!tab || !s) return;
  const opened = s.openedAt !== undefined;
  const sent = s.sent + l.pending.filter((e) => e.dir === 'sent').length;
  const received = s.received + l.pending.filter((e) => e.dir === 'received').length;
  const request = JSON.parse(JSON.stringify(tab.request));
  // The composer and saved messages travel with the request; the log never does.
  const response = {
    status: opened ? 101 : 0,
    statusText: opened ? t('wsHistoryStatus', sent, received) : t('wsHistoryFailed'),
    headers: {},
    body: '',
    size: s.log.reduce((n, e) => n + e.size, 0),
    time: Date.now() - s.startedAt,
    contentType: '',
  };
  const entryOut = { id: generateId(), request: { ...request, ws: wsConfig(request) }, response, timestamp: s.startedAt };
  browser.runtime.sendMessage({ action: 'addHistory', entry: entryOut }).catch((e) => console.warn('Could not save history:', e));
}
