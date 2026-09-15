/** Response body classification, decoding and inspection helpers. */

import type { ApiResponse } from './request';

export type BodyKind = 'json' | 'html' | 'xml' | 'text' | 'image' | 'binary' | 'empty';

export function parseContentType(contentType: string): { mime: string; charset: string | null } {
  const [mimePart = '', ...params] = contentType.split(';');
  let charset: string | null = null;
  for (const p of params) {
    const [k, val] = p.split('=');
    if (k?.trim().toLowerCase() === 'charset' && val) charset = val.trim().replace(/^"|"$/g, '');
  }
  return { mime: mimePart.trim().toLowerCase(), charset };
}

/** True if the first bytes look like binary data rather than text. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 1024);
  if (n === 0) return false;
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32)) control++;
  }
  return control / n > 0.1;
}

export function classifyBody(contentType: string, bytes: Uint8Array): BodyKind {
  if (bytes.length === 0) return 'empty';
  const { mime } = parseContentType(contentType);
  if (mime === 'application/json' || mime.endsWith('+json') || mime === 'text/json') return 'json';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime === 'image/svg+xml') return 'image';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/xml' || mime === 'text/xml' || mime.endsWith('+xml')) return 'xml';
  const textual =
    mime.startsWith('text/') ||
    mime === 'application/javascript' ||
    mime === 'application/x-www-form-urlencoded' ||
    mime === 'application/yaml' ||
    mime === 'application/x-yaml' ||
    mime === 'application/graphql';
  if (textual || mime === '') {
    if (looksBinary(bytes)) return 'binary';
    // Plenty of APIs send JSON as text/plain or with no type at all.
    const first = firstNonSpace(bytes);
    if (first === 0x7b || first === 0x5b) {
      try {
        JSON.parse(new TextDecoder().decode(bytes));
        return 'json';
      } catch {
        // not JSON
      }
    }
    return 'text';
  }
  return looksBinary(bytes) ? 'binary' : mime.startsWith('application/') ? 'binary' : 'text';
}

function firstNonSpace(bytes: Uint8Array): number | undefined {
  for (let i = 0; i < Math.min(bytes.length, 256); i++) {
    const b = bytes[i]!;
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0xef && b !== 0xbb && b !== 0xbf) return b;
  }
  return undefined;
}

export function isTextualKind(kind: BodyKind): boolean {
  return kind === 'json' || kind === 'html' || kind === 'xml' || kind === 'text';
}

export function decodeText(bytes: Uint8Array, charset: string | null): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Classic hex dump: offset, 16 bytes of hex, printable ASCII. */
export function hexDump(bytes: Uint8Array, maxBytes = 512): string {
  const lines: string[] = [];
  const n = Math.min(bytes.length, maxBytes);
  for (let off = 0; off < n; off += 16) {
    const chunk = bytes.subarray(off, Math.min(off + 16, n));
    const hex = Array.from(chunk, b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk, b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  |${ascii}|`);
  }
  if (bytes.length > n) lines.push(`… ${bytes.length - n} more bytes`);
  return lines.join('\n');
}

/** Start/end offsets of every occurrence of `query` in `text`, up to `limit`. */
export function findMatches(text: string, query: string, caseSensitive = false, limit = 5000): Array<[number, number]> {
  if (!query) return [];
  // Match on the original text so offsets stay right even where lower-casing changes length.
  const source = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re: RegExp;
  try {
    re = new RegExp(source, caseSensitive ? 'gu' : 'giu');
  } catch {
    re = new RegExp(source, caseSensitive ? 'g' : 'gi');
  }
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while (out.length < limit && (m = re.exec(text)) !== null) {
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

const EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'text/html': 'html',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
};

/** A download filename from the URL's last path segment and the content type. */
export function downloadFileName(url: string, contentType: string): string {
  const { mime } = parseContentType(contentType);
  let last = '';
  try {
    last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    // keep default
  }
  const ext = EXTENSIONS[mime] || (mime.endsWith('+json') ? 'json' : 'bin');
  const base = (last || 'response').replace(/[^\w.-]+/g, '_');
  return /\.[a-z0-9]{1,5}$/i.test(base) ? base : `${base}.${ext}`;
}

/** Bytes of text stored with a history entry; larger bodies are cut. */
export const HISTORY_BODY_LIMIT = 64 * 1024;

export function headersToRecord(headers: Array<[string, string]>): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const [k, v] of headers) out[k] = Object.hasOwn(out, k) ? `${out[k]}, ${v}` : v;
  return out;
}

export interface HistoryResponseInput {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  size: number;
  time: number;
  contentType: string;
  kind: BodyKind;
  text?: string;
}

/** The summary kept in history: textual bodies up to the limit, binary bodies omitted. */
export function toHistoryResponse(res: HistoryResponseInput): ApiResponse {
  let body = '';
  if (isTextualKind(res.kind) && res.text) {
    body = res.text.length > HISTORY_BODY_LIMIT ? res.text.slice(0, HISTORY_BODY_LIMIT) : res.text;
  }
  return {
    status: res.status,
    statusText: res.statusText,
    headers: headersToRecord(res.headers),
    body,
    size: res.size,
    time: Math.round(res.time),
    contentType: res.contentType,
  };
}

export interface FetchFailure {
  title: string;
  detail: string;
}

/** Explain a fetch() rejection in words a person can act on. */
export function describeFetchError(error: unknown, ctx: { cancelled?: boolean; timedOut?: boolean; timeoutMs?: number; url: string }): FetchFailure {
  if (ctx.timedOut) {
    return {
      title: 'Request timed out',
      detail: `No response arrived within ${Math.round((ctx.timeoutMs || 0) / 1000)} s. The server may be slow or unreachable; raise the timeout in Settings if this endpoint is expected to be slow.`,
    };
  }
  if (ctx.cancelled) return { title: 'Request cancelled', detail: 'You cancelled the request before a response arrived.' };
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(message)) {
    let host = ctx.url;
    try {
      host = new URL(ctx.url).host;
    } catch {
      // keep url
    }
    return {
      title: 'Could not connect',
      detail: `No response from ${host}. Check the address, that the server is running, and your network or VPN. A DNS failure, a refused connection and an invalid TLS certificate all fail this way in the browser.`,
    };
  }
  return { title: 'Request failed', detail: message };
}
