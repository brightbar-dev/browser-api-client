/**
 * WebSocket requests: the saved configuration, URL and subprotocol handling, message
 * validation and the in-memory message log. Pure — the app page owns the socket itself.
 *
 * A WebSocket request is an ApiRequest with `kind: 'websocket'` and a `ws` member. Every
 * request saved before this existed has neither, and is an HTTP request.
 */

import type { ApiRequest } from './request';
import { generateId, newRequest } from './request';
import type { EnvVariable } from './environment';
import { interpolate, unresolvedVariables } from './environment';
import { hasScheme, isLocalHost } from './url';

export type WsMessageFormat = 'text' | 'json';

/** A message the user keeps with the request to send again. */
export interface SavedWsMessage {
  id: string;
  name: string;
  format: WsMessageFormat;
  text: string;
}

export interface WsConfig {
  /** Subprotocols to offer, as typed: comma or space separated. */
  protocols: string;
  /** The message in the composer. */
  draft: string;
  draftFormat: WsMessageFormat;
  saved: SavedWsMessage[];
}

export const MAX_SAVED_MESSAGES = 200;

export function newWsConfig(): WsConfig {
  return { protocols: '', draft: '', draftFormat: 'text', saved: [] };
}

export function isWebSocketRequest(req: Pick<ApiRequest, 'kind'>): boolean {
  return req.kind === 'websocket';
}

/** What the method tag shows for a request: its HTTP method, or WS. */
export function methodLabel(req: Pick<ApiRequest, 'kind' | 'method'>): string {
  return req.kind === 'websocket' ? 'WS' : req.method;
}

export function newWebSocketRequest(name = 'New Request'): ApiRequest {
  return { ...newRequest(name), kind: 'websocket', ws: newWsConfig() };
}

/** Turn a request into a WebSocket one in place, keeping its URL (http → ws, https → wss). */
export function toWebSocketRequest(req: ApiRequest): ApiRequest {
  return { ...req, kind: 'websocket', method: 'GET', url: req.url.replace(/^http(s?):\/\//i, (_, s: string) => `ws${s}://`), ws: req.ws ?? newWsConfig() };
}

/** Turn a WebSocket request back into an HTTP one (its WebSocket settings are dropped). */
export function toHttpRequest(req: ApiRequest): ApiRequest {
  const { kind: _kind, ws: _ws, ...rest } = req;
  return { ...rest, url: rest.url.replace(/^ws(s?):\/\//i, (_, s: string) => `http${s}://`) };
}

export function wsConfig(req: ApiRequest): WsConfig {
  return req.ws ?? newWsConfig();
}

// --- URL ---

/** The scheme a bare host gets: `ws` for local hosts, `wss` otherwise. */
export function impliedWsScheme(url: string): 'ws' | 'wss' | null {
  const t = url.trim();
  if (!t || hasScheme(t) || t.startsWith('{{')) return null;
  const host = t.replace(/^\/\//, '').split(/[/?#]/)[0] ?? '';
  return isLocalHost(host) ? 'ws' : 'wss';
}

export type WsUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * An interpolated URL as the WebSocket constructor wants it. A bare host gets ws:// (local)
 * or wss://; http(s) is mapped to ws(s) because that is what people paste; other schemes
 * are refused with a message fit to show.
 */
export function toWebSocketUrl(input: string): WsUrlResult {
  let text = input.trim();
  if (!text) return { ok: false, error: 'Enter a ws:// or wss:// URL to connect to.' };
  const implied = impliedWsScheme(text);
  if (implied) text = `${implied}://${text.replace(/^\/\//, '')}`;
  text = text.replace(/^http(s?):\/\//i, (_, s: string) => `ws${s}://`);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: `"${text}" is not a valid URL.` };
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return { ok: false, error: `WebSocket URLs start with ws:// or wss:// (got ${parsed.protocol.replace(':', '')}).` };
  }
  if (parsed.hash) {
    // The constructor rejects fragments.
    parsed.hash = '';
  }
  return { ok: true, url: parsed.toString() };
}

// --- subprotocols ---

/** RFC 6455 §4.1: a subprotocol is an HTTP token. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export interface ParsedProtocols {
  protocols: string[];
  /** Entries that are not valid subprotocol names (the constructor would throw on them). */
  invalid: string[];
}

/** Split "a, b c" into names, dropping blanks and repeats. */
export function parseProtocols(text: string): ParsedProtocols {
  const protocols: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    if (!raw) continue;
    if (!TOKEN.test(raw)) {
      if (!invalid.includes(raw)) invalid.push(raw);
    } else if (!protocols.includes(raw)) {
      protocols.push(raw);
    }
  }
  return { protocols, invalid };
}

// --- resolving a request for connecting ---

export interface ResolvedWs {
  url: string;
  protocols: string[];
}

export interface WsResolveResult {
  resolved?: ResolvedWs;
  error?: string;
  /** Variables used in the URL, protocols or message that the environment does not define. */
  unresolved: string[];
}

/** Interpolate variables and validate what is needed to open the socket. */
export function resolveWebSocket(req: ApiRequest, variables: EnvVariable[]): WsResolveResult {
  const cfg = wsConfig(req);
  const unresolved = [...new Set([...unresolvedVariables(req.url, variables), ...unresolvedVariables(cfg.protocols, variables)])];
  const url = toWebSocketUrl(interpolate(req.url, variables));
  if (!url.ok) return { error: url.error, unresolved };
  const { protocols, invalid } = parseProtocols(interpolate(cfg.protocols, variables));
  if (invalid.length > 0) {
    return { error: `Not a valid subprotocol name: ${invalid.join(', ')}. Names use letters, digits and ! # $ % & ' * + - . ^ _ \` | ~.`, unresolved };
  }
  return { resolved: { url: url.url, protocols }, unresolved };
}

// --- messages ---

export type JsonCheck = { ok: true; formatted: string } | { ok: false; error: string };

/** Is `text` JSON? On success, `formatted` is the pretty-printed form. */
export function checkJson(text: string): JsonCheck {
  if (!text.trim()) return { ok: false, error: 'Empty' };
  try {
    return { ok: true, formatted: JSON.stringify(JSON.parse(text), null, 2) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The same JSON on one line, or null when it is not valid. */
export function minifyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return null;
  }
}

export type PrepareMessage = { ok: true; text: string } | { ok: false; error: string };

/**
 * The text to send for a message: variables interpolated; JSON must parse (and goes out as
 * written, so the user's own formatting is kept — only validation, never rewriting).
 */
export function prepareMessage(text: string, format: WsMessageFormat, variables: EnvVariable[]): PrepareMessage {
  if (text === '') return { ok: false, error: 'Type a message to send.' };
  const out = interpolate(text, variables);
  if (format === 'json') {
    const check = checkJson(out);
    if (!check.ok) return { ok: false, error: `Not valid JSON: ${check.error}` };
  }
  return { ok: true, text: out };
}

export function utf8Size(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

// --- the log ---

export type WsDirection = 'sent' | 'received' | 'system';

export interface WsLogEntry {
  id: number;
  at: number;
  dir: WsDirection;
  /** `text` and `binary` are messages; the rest are connection events. */
  kind: 'text' | 'binary' | 'open' | 'close' | 'error' | 'info';
  text: string;
  /** Bytes, for messages. */
  size: number;
}

/** Entries kept per connection; older ones are dropped (and counted) beyond this. */
export const MAX_LOG_ENTRIES = 2000;
/** A single message longer than this is cut in the log (the full message was still sent/received). */
export const MAX_LOG_TEXT = 256 * 1024;

export function clipLogText(text: string): string {
  return text.length > MAX_LOG_TEXT ? `${text.slice(0, MAX_LOG_TEXT)}… (${text.length - MAX_LOG_TEXT} more characters not shown)` : text;
}

/** Append entries, dropping the oldest past the cap. Returns the new list and how many fell off. */
export function appendLog(log: WsLogEntry[], added: WsLogEntry[], max = MAX_LOG_ENTRIES): { log: WsLogEntry[]; dropped: number } {
  const all = log.concat(added);
  if (all.length <= max) return { log: all, dropped: 0 };
  return { log: all.slice(all.length - max), dropped: all.length - max };
}

export interface LogFilter {
  query?: string;
  dir?: WsDirection | 'all' | 'messages';
}

/** Filter the log by direction and case-insensitive text. `messages` hides connection events. */
export function filterLog(log: WsLogEntry[], f: LogFilter): WsLogEntry[] {
  const q = (f.query ?? '').trim().toLowerCase();
  const dir = f.dir ?? 'all';
  return log.filter((e) => {
    if (dir === 'messages' && e.dir === 'system') return false;
    if ((dir === 'sent' || dir === 'received' || dir === 'system') && e.dir !== dir) return false;
    return !q || e.text.toLowerCase().includes(q);
  });
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local time with milliseconds, `14:03:07.412`. */
export function formatLogTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const DIR_WORD: Record<WsDirection, string> = { sent: 'Sent', received: 'Received', system: 'Event' };

/** The log as plain text, one block per entry, for copying or downloading. */
export function logToText(log: WsLogEntry[]): string {
  return log
    .map((e) => {
      const head = `[${new Date(e.at).toISOString()}] ${DIR_WORD[e.dir]}${e.kind === 'binary' ? ' (binary)' : ''}`;
      return e.text.includes('\n') ? `${head}\n${e.text}` : `${head}: ${e.text}`;
    })
    .join('\n');
}

/** Names for the close codes people meet (RFC 6455 §7.4.1 and the registered ones). */
export function closeCodeLabel(code: number): string {
  switch (code) {
    case 1000: return 'normal closure';
    case 1001: return 'going away';
    case 1002: return 'protocol error';
    case 1003: return 'unsupported data';
    case 1005: return 'no status code';
    case 1006: return 'closed abnormally (no close frame)';
    case 1007: return 'invalid data';
    case 1008: return 'policy violation';
    case 1009: return 'message too big';
    case 1010: return 'extension required';
    case 1011: return 'server error';
    case 1012: return 'service restart';
    case 1013: return 'try again later';
    case 1015: return 'TLS handshake failed';
    default: return code >= 4000 && code <= 4999 ? 'application-defined code' : 'unknown code';
  }
}

/** The log line for a close event. */
export function describeClose(code: number, reason: string, wasClean: boolean): string {
  const base = `Closed with code ${code} (${closeCodeLabel(code)})`;
  const why = reason ? `, reason: ${reason}` : '';
  return wasClean || code === 1000 ? `${base}${why}` : `${base}${why}. The connection did not end with a close handshake.`;
}

// --- saved messages ---

export function newSavedMessage(name: string, format: WsMessageFormat, text: string): SavedWsMessage {
  return { id: generateId(), name, format, text };
}

/** A short default name for a message: JSON on one line, else the first line, trimmed. */
export function defaultMessageName(text: string): string {
  const line = minifyJson(text) ?? text.trim().split('\n')[0] ?? '';
  return line.length > 40 ? `${line.slice(0, 39)}…` : line || 'Message';
}
