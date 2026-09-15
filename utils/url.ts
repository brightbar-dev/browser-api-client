/**
 * URL text ⇄ query params sync, and scheme defaulting.
 *
 * Everything here works on the raw text the user typed, never through `new URL()`,
 * so `{{variables}}`, half-typed URLs and unusual encodings survive a round trip.
 * The URL field owns enabled params; disabled params exist only in the params table.
 */

import type { KeyValuePair } from './request';

export interface SplitUrl {
  base: string;
  /** Text after `?`, or null when there is no `?`. */
  query: string | null;
  /** `#fragment` including the `#`, or ''. */
  hash: string;
}

export function splitUrl(url: string): SplitUrl {
  let rest = url;
  let hash = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    hash = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  }
  const q = rest.indexOf('?');
  if (q === -1) return { base: rest, query: null, hash };
  return { base: rest.slice(0, q), query: rest.slice(q + 1), hash };
}

/** Parse a raw query string into enabled params. Values stay exactly as typed. */
export function parseQuery(query: string): KeyValuePair[] {
  const params: KeyValuePair[] = [];
  for (const segment of query.split('&')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    if (eq === -1) params.push({ key: segment, value: '', enabled: true });
    else params.push({ key: segment.slice(0, eq), value: segment.slice(eq + 1), enabled: true });
  }
  return params;
}

/**
 * Params after the user edited the URL: the URL's query becomes the enabled params,
 * and disabled rows from the previous table keep their place among them.
 */
export function paramsFromUrl(url: string, previous: KeyValuePair[] = []): KeyValuePair[] {
  const { query } = splitUrl(url);
  const fromUrl = query === null ? [] : parseQuery(query);
  const result: KeyValuePair[] = [];
  for (const p of previous) {
    if (!p.enabled) result.push(p);
    else if (fromUrl.length > 0) result.push(fromUrl.shift()!);
  }
  result.push(...fromUrl);
  return result;
}

function encodeQueryPart(text: string, isKey: boolean): string {
  let out = text.replace(/&/g, '%26').replace(/#/g, '%23');
  if (isKey) out = out.replace(/=/g, '%3D');
  return out;
}

/** Serialize enabled params as a raw query string (no leading `?`). */
export function serializeQuery(params: KeyValuePair[]): string {
  return params
    .filter(p => p.enabled && (p.key !== '' || p.value !== ''))
    .map(p => (p.value === '' ? encodeQueryPart(p.key, true) : `${encodeQueryPart(p.key, true)}=${encodeQueryPart(p.value, false)}`))
    .join('&');
}

/** The URL after the user edited the params table. */
export function urlWithParams(url: string, params: KeyValuePair[]): string {
  const { base, hash } = splitUrl(url);
  const query = serializeQuery(params);
  return query ? `${base}?${query}${hash}` : `${base}${hash}`;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function hasScheme(url: string): boolean {
  return SCHEME_RE.test(url.trim());
}

/** True for hosts that normally speak plain http: loopback, private ranges, .local/.localhost/.test. */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return (
    h === 'localhost' ||
    h === '[::1]' ||
    h === '0.0.0.0' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /\.(local|localhost|test|internal)$/.test(h)
  );
}

/**
 * The scheme a URL without one will be sent with, or null if it already has one
 * (or starts with a variable that supplies it).
 */
export function impliedScheme(url: string): 'http' | 'https' | null {
  const t = url.trim();
  if (!t || hasScheme(t) || t.startsWith('{{')) return null;
  const host = t.replace(/^\/\//, '').split(/[/?#]/)[0] ?? '';
  return isLocalHost(host) ? 'http' : 'https';
}

/** Prefix the implied scheme, if any: `api.example.com/x` → `https://api.example.com/x`. */
export function withDefaultScheme(url: string): string {
  const t = url.trim();
  const scheme = impliedScheme(t);
  return scheme ? `${scheme}://${t.replace(/^\/\//, '')}` : t;
}

/**
 * Turn an interpolated URL into what fetch will request, or throw an Error whose
 * message is fit to show the user.
 */
export function toRequestUrl(url: string): string {
  const withScheme = withDefaultScheme(url);
  if (!withScheme) throw new Error('Enter a URL to send the request to.');
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`"${withScheme}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http and https URLs can be sent (got ${parsed.protocol.replace(':', '')}).`);
  }
  return parsed.toString();
}
