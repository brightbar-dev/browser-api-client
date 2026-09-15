/**
 * Resolve an editable request into exactly what will be sent: variables interpolated,
 * auth applied, URL made absolute, Content-Type chosen. Pure — the app page turns the
 * result into a fetch() call and the code generators print it.
 */

import type { ApiRequest, ResolvedBody, ResolvedRequest } from './request';
import { base64Utf8 } from './request';
import type { EnvVariable } from './environment';
import { interpolate, extractVariables } from './environment';
import { parseQuery, serializeQuery, splitUrl, toRequestUrl, urlWithParams } from './url';
import { t } from './i18n';

export const TEXT_CONTENT_TYPES = [
  'text/plain',
  'application/xml',
  'text/xml',
  'text/html',
  'text/csv',
  'application/javascript',
  'application/x-yaml',
];

/**
 * Request headers a page cannot set: fetch() drops them without an error.
 * https://fetch.spec.whatwg.org/#forbidden-request-header
 */
const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
  'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive',
  'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
]);

export function isForbiddenHeader(name: string): boolean {
  const n = name.trim().toLowerCase();
  return FORBIDDEN_HEADERS.has(n) || n.startsWith('proxy-') || n.startsWith('sec-');
}

/** RFC 7230 token characters — anything else makes `new Headers()` throw. */
export function isValidHeaderName(name: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name);
}

export function methodAllowsBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

export function findHeader(headers: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([k]) => k.toLowerCase() === lower)?.[1];
}

function setHeader(headers: Array<[string, string]>, name: string, value: string): Array<[string, string]> {
  const lower = name.toLowerCase();
  return [...headers.filter(([k]) => k.toLowerCase() !== lower), [name, value]];
}

export interface ResolveResult {
  request: ResolvedRequest;
  /** Things the user should know before sending; the request is still sendable. */
  warnings: string[];
  /** `{{names}}` used by the request that no enabled variable defines. */
  unresolved: string[];
  /** Set when the request cannot be sent as is (for example an invalid URL). */
  error?: string;
}

export interface ResolveOptions {
  /** Access token for OAuth 2.0 auth, fetched by the caller. */
  oauthToken?: { accessToken: string; tokenType?: string };
}

export function resolveRequest(req: ApiRequest, variables: EnvVariable[], opts: ResolveOptions = {}): ResolveResult {
  const warnings: string[] = [];
  const used = new Set<string>();
  const v = (text: string): string => {
    for (const name of extractVariables(text)) used.add(name);
    return interpolate(text, variables);
  };

  // URL: the params table is the source of truth for the query. When the typed URL
  // already says the same thing, send it exactly as typed (`?flag=` stays `?flag=`).
  const typedQuery = splitUrl(req.url).query;
  const inSync = serializeQuery(typedQuery === null ? [] : parseQuery(typedQuery)) === serializeQuery(req.params);
  let rawUrl = v(inSync ? req.url : urlWithParams(req.url, req.params));
  const auth = req.auth;
  if (auth.type === 'api-key' && auth.apiKeyIn === 'query' && auth.headerName && auth.headerValue) {
    const pair = `${encodeURIComponent(v(auth.headerName))}=${encodeURIComponent(v(auth.headerValue))}`;
    const hashIdx = rawUrl.indexOf('#');
    const beforeHash = hashIdx === -1 ? rawUrl : rawUrl.slice(0, hashIdx);
    const hash = hashIdx === -1 ? '' : rawUrl.slice(hashIdx);
    rawUrl = `${beforeHash}${beforeHash.includes('?') ? '&' : '?'}${pair}${hash}`;
  }

  let url = rawUrl;
  let error: string | undefined;
  try {
    url = toRequestUrl(rawUrl);
  } catch (e) {
    error = (e as Error).message;
  }

  // Headers, in order, repeats allowed.
  let headers: Array<[string, string]> = [];
  for (const h of req.headers) {
    if (!h.enabled || !h.key.trim()) continue;
    const name = v(h.key).trim();
    headers.push([name, v(h.value)]);
    if (!isValidHeaderName(name)) {
      error ??= t('resolveInvalidHeaderName', name);
    } else if (isForbiddenHeader(name)) {
      warnings.push(t('warnForbiddenHeader', name));
    }
  }

  const userSetAuthorization = findHeader(headers, 'authorization') !== undefined;
  let authorizationApplied = false;
  if (auth.type === 'bearer' && auth.token) {
    headers = setHeader(headers, 'Authorization', `Bearer ${v(auth.token)}`);
    authorizationApplied = true;
  } else if (auth.type === 'basic' && (auth.username || auth.password)) {
    headers = setHeader(headers, 'Authorization', `Basic ${base64Utf8(`${v(auth.username || '')}:${v(auth.password || '')}`)}`);
    authorizationApplied = true;
  } else if (auth.type === 'oauth2' && opts.oauthToken?.accessToken) {
    const tokenType = opts.oauthToken.tokenType && !/^bearer$/i.test(opts.oauthToken.tokenType) ? opts.oauthToken.tokenType : 'Bearer';
    headers = setHeader(headers, 'Authorization', `${tokenType} ${opts.oauthToken.accessToken}`);
    authorizationApplied = true;
  } else if (auth.type === 'api-key' && auth.apiKeyIn !== 'query' && auth.headerName && auth.headerValue) {
    const name = v(auth.headerName).trim();
    if (isValidHeaderName(name)) headers = setHeader(headers, name, v(auth.headerValue));
    else error ??= t('resolveInvalidApiKeyHeaderName', name);
  }
  if (userSetAuthorization && authorizationApplied) {
    warnings.push(t('warnAuthReplacesHeader'));
  }

  // Body.
  let body: ResolvedBody = { kind: 'none' };
  const withContentType = (type: string) => {
    if (findHeader(headers, 'content-type') === undefined) headers.push(['Content-Type', type]);
  };

  if (req.bodyType !== 'none' && !methodAllowsBody(req.method)) {
    warnings.push(t('warnMethodNoBody', req.method));
  } else {
    switch (req.bodyType) {
      case 'json': {
        const text = v(req.body);
        body = { kind: 'text', text };
        withContentType('application/json');
        if (text.trim()) {
          try {
            JSON.parse(text);
          } catch {
            warnings.push(t('warnInvalidJsonBody'));
          }
        }
        break;
      }
      case 'text':
        body = { kind: 'text', text: v(req.body) };
        withContentType(req.textContentType || 'text/plain');
        break;
      case 'graphql': {
        let variablesValue: unknown;
        const varsText = v(req.graphqlVariables || '').trim();
        if (varsText) {
          try {
            variablesValue = JSON.parse(varsText);
          } catch {
            warnings.push(t('warnInvalidGraphqlVariables'));
          }
        }
        const payload: Record<string, unknown> = { query: v(req.body) };
        if (variablesValue !== undefined) payload.variables = variablesValue;
        body = { kind: 'text', text: JSON.stringify(payload) };
        withContentType('application/json');
        break;
      }
      case 'form': {
        const fields = (req.formFields || [])
          .filter(f => f.enabled && f.key !== '')
          .map((f): [string, string] => [v(f.key), v(f.value)]);
        body = { kind: 'urlencoded', fields };
        withContentType('application/x-www-form-urlencoded');
        break;
      }
      case 'multipart': {
        const fields: Array<{ name: string; value?: string; file?: ApiRequest['binaryFile'] }> = [];
        for (const f of req.multipartFields || []) {
          if (!f.enabled || f.key === '') continue;
          if (f.kind === 'file') {
            if (f.file) fields.push({ name: v(f.key), file: f.file });
            else warnings.push(t('warnMultipartNoFile', f.key));
          } else {
            fields.push({ name: v(f.key), value: v(f.value) });
          }
        }
        body = { kind: 'multipart', fields: fields as Array<{ name: string; value?: string; file?: NonNullable<ApiRequest['binaryFile']> }> };
        if (findHeader(headers, 'content-type') !== undefined) {
          warnings.push(t('warnMultipartContentType'));
        }
        break;
      }
      case 'binary':
        if (req.binaryFile) {
          body = { kind: 'binary', file: req.binaryFile };
          withContentType(req.binaryFile.type || 'application/octet-stream');
        } else {
          warnings.push(t('warnBinaryNoFile'));
        }
        break;
    }
  }

  const defined = new Set(variables.filter(x => x.enabled && x.key).map(x => x.key));
  const unresolved = [...used].filter(name => !defined.has(name));

  return { request: { method: req.method, url, headers, body }, warnings, unresolved, error };
}

/** The x-www-form-urlencoded encoding fetch() produces for these fields. */
export function encodeUrlencoded(fields: Array<[string, string]>): string {
  return new URLSearchParams(fields).toString();
}
