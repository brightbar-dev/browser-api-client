/**
 * Import requests from a HAR 1.2 file (DevTools "Save all as HAR").
 *
 * Each `log.entries[].request` becomes a request. The URL is used as recorded (it includes
 * the query). HTTP/2 pseudo-headers, hop-by-hop headers, Host, Content-Length and the
 * browser's Cookie header are dropped. Bodies are typed the same way as curl imports.
 */

import type { ApiRequest, HttpMethod, KeyValuePair, MultipartField } from './request';
import type { ImportResult } from './curl-import';
import { HTTP_METHODS, newRequest } from './request';
import {
  applyTextBody,
  authFromHeaders,
  headerValue,
  mediaTypeOf,
  queryParamsFromUrl,
  reattachWarning,
  removeHeaders,
  requestNameFromUrl,
} from './curl-import';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Headers that describe one connection or are set by the browser itself. */
const DROPPED_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'host', 'content-length',
]);

/**
 * Import every request in a HAR file. Throws an Error with a user-facing message when the
 * text is not JSON or has no `log.entries`; skipped entries and dropped data are warnings.
 */
export function importHar(json: string): ImportResult<ApiRequest[]> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`The HAR file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const log = isObj(data) && isObj(data.log) ? data.log : undefined;
  if (!log || !Array.isArray(log.entries)) {
    throw new Error('This is not a HAR file (it has no log.entries).');
  }

  const warnings: string[] = [];
  const requests: ApiRequest[] = [];
  let nonHttp = 0;
  let withCookies = 0;
  const badMethods = new Set<string>();

  for (const entry of log.entries) {
    const hr = isObj(entry) && isObj(entry.request) ? entry.request : undefined;
    if (!hr) continue;
    const url = str(hr.url);
    if (!/^https?:\/\//i.test(url)) {
      nonHttp++;
      continue;
    }
    const method = str(hr.method).toUpperCase();
    if (!(HTTP_METHODS as string[]).includes(method)) {
      badMethods.add(method || '(none)');
      continue;
    }

    const req = newRequest(requestNameFromUrl(method, url));
    req.method = method as HttpMethod;
    req.url = url;
    req.params = queryParamsFromUrl(url);

    let headers: KeyValuePair[] = [];
    let hadCookie = false;
    for (const h of Array.isArray(hr.headers) ? hr.headers : []) {
      if (!isObj(h)) continue;
      const name = str(h.name);
      const lower = name.toLowerCase();
      if (!name || name.startsWith(':') || DROPPED_HEADERS.has(lower)) continue;
      if (lower === 'cookie') {
        hadCookie = true;
        continue;
      }
      headers.push({ key: name, value: str(h.value), enabled: true });
    }
    if (hadCookie) withCookies++;

    const fromHeader = authFromHeaders(headers);
    headers = fromHeader.headers;
    if (fromHeader.auth) req.auth = fromHeader.auth;
    req.headers = headers;

    applyHarBody(req, hr.postData, warnings);
    requests.push(req);
  }

  if (requests.length === 0 && log.entries.length === 0) warnings.push('The HAR file has no requests.');
  if (nonHttp > 0) warnings.push(`Skipped ${nonHttp} ${nonHttp === 1 ? 'entry that is' : 'entries that are'} not http or https.`);
  if (badMethods.size > 0) warnings.push(`Skipped requests with unsupported methods: ${[...badMethods].join(', ')}.`);
  if (withCookies > 0) {
    warnings.push(`Browser cookies were not imported (${withCookies} ${withCookies === 1 ? 'request' : 'requests'}). Add a Cookie header by hand if the API needs one.`);
  }
  return { value: requests, warnings };
}

function applyHarBody(req: ApiRequest, postData: unknown, warnings: string[]): void {
  if (!isObj(postData)) return;
  const contentType = headerValue(req.headers, 'content-type') ?? (str(postData.mimeType) || undefined);
  const text = typeof postData.text === 'string' ? postData.text : undefined;
  const params = (Array.isArray(postData.params) ? postData.params : []).filter(isObj);

  if (text !== undefined && text !== '') {
    applyTextBody(req, text, contentType, warnings);
    // A multipart body whose text could not be split still has its params to fall back on.
    if (!(req.bodyType === 'text' && mediaTypeOf(contentType ?? '') === 'multipart/form-data' && params.length > 0)) return;
  }
  if (params.length === 0) {
    if (text !== undefined) applyTextBody(req, '', contentType, warnings);
    return;
  }

  if (mediaTypeOf(contentType ?? '') === 'multipart/form-data') {
    req.bodyType = 'multipart';
    req.body = '';
    req.textContentType = undefined;
    req.multipartFields = params.map((p): MultipartField => {
      const key = str(p.name);
      if (typeof p.fileName === 'string') {
        warnings.push(reattachWarning(key));
        return { key, value: p.fileName, enabled: true, kind: 'file' };
      }
      return { key, value: str(p.value), enabled: true, kind: 'text' };
    });
    req.headers = removeHeaders(req.headers, 'content-type');
    return;
  }
  req.bodyType = 'form';
  req.body = '';
  req.formFields = params.map(p => ({ key: str(p.name), value: str(p.value), enabled: true }));
  if ((contentType ?? '').trim().toLowerCase() === 'application/x-www-form-urlencoded') {
    req.headers = removeHeaders(req.headers, 'content-type');
  }
}
