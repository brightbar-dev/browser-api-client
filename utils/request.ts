/** HTTP request model, building and formatting utilities. */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface KeyValuePair {
  key: string;
  value: string;
  enabled: boolean;
}

/**
 * Request body modes.
 * - `json` / `text` / `graphql` keep their source in `body`.
 * - `form` is application/x-www-form-urlencoded, fields in `formFields`.
 * - `multipart` is multipart/form-data, fields in `multipartFields`.
 * - `binary` sends one file, `binaryFile`.
 */
export type BodyType = 'none' | 'json' | 'form' | 'multipart' | 'text' | 'binary' | 'graphql';

/** A file chosen by the user. Its bytes live in IndexedDB under `id`, never in storage.local. */
export interface FileRef {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface MultipartField {
  key: string;
  value: string;
  enabled: boolean;
  kind: 'text' | 'file';
  file?: FileRef;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  /** The URL as typed, including its query string. `params` mirrors the query. */
  url: string;
  headers: KeyValuePair[];
  /** Every query param, including disabled ones (which are not in `url`). */
  params: KeyValuePair[];
  body: string;
  bodyType: BodyType;
  /** Content type for `text` bodies. Defaults to text/plain. */
  textContentType?: string;
  formFields?: KeyValuePair[];
  multipartFields?: MultipartField[];
  binaryFile?: FileRef;
  /** JSON source of GraphQL variables, for `graphql` bodies. */
  graphqlVariables?: string;
  auth: AuthConfig;
}

export interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'api-key';
  token?: string;
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
  /** Where an API key goes. Defaults to header. */
  apiKeyIn?: 'header' | 'query';
}

/** Stored response summary (history entries). */
export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  size: number;
  time: number;
  contentType: string;
}

/** A body after variables are resolved, ready to encode or to print as code. */
export type ResolvedBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'urlencoded'; fields: Array<[string, string]> }
  | { kind: 'multipart'; fields: Array<{ name: string; value?: string; file?: FileRef }> }
  | { kind: 'binary'; file: FileRef };

/**
 * A request with variables interpolated, auth applied and the URL made absolute.
 * `headers` is ordered and may repeat a name. Content-Type is present for text,
 * urlencoded and binary bodies (unless the user chose otherwise) and absent for
 * multipart, whose boundary the encoder must choose.
 */
export interface ResolvedRequest {
  method: HttpMethod;
  url: string;
  headers: Array<[string, string]>;
  body: ResolvedBody;
}

/** Build URL with query parameters. */
export function buildUrl(baseUrl: string, params: KeyValuePair[]): string {
  const enabled = params.filter(p => p.enabled && p.key);
  if (enabled.length === 0) return baseUrl;

  const url = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`);
  for (const p of enabled) {
    url.searchParams.append(p.key, p.value);
  }
  return url.toString();
}

/** Parse a URL into base + query params. */
export function parseUrl(url: string): { base: string; params: KeyValuePair[] } {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const params: KeyValuePair[] = [];
    u.searchParams.forEach((value, key) => {
      params.push({ key, value, enabled: true });
    });
    u.search = '';
    return { base: u.toString(), params };
  } catch {
    return { base: url, params: [] };
  }
}

/** Build headers map from key-value pairs + auth config. */
export function buildHeaders(headers: KeyValuePair[], auth: AuthConfig): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    if (h.enabled && h.key) {
      result[h.key] = h.value;
    }
  }

  switch (auth.type) {
    case 'bearer':
      if (auth.token) result['Authorization'] = `Bearer ${auth.token}`;
      break;
    case 'basic':
      if (auth.username) {
        const encoded = base64Utf8(`${auth.username}:${auth.password || ''}`);
        result['Authorization'] = `Basic ${encoded}`;
      }
      break;
    case 'api-key':
      if (auth.headerName && auth.headerValue && auth.apiKeyIn !== 'query') {
        result[auth.headerName] = auth.headerValue;
      }
      break;
  }

  return result;
}

/** Base64 of a string's UTF-8 bytes (btoa alone throws on non-Latin-1). */
export function base64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Format response size for display. */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format response time for display. */
export function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Get status color class. */
export function statusColor(status: number): 'success' | 'redirect' | 'client-error' | 'server-error' | 'info' {
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  if (status >= 300) return 'redirect';
  if (status >= 200) return 'success';
  return 'info';
}

/** Generate unique ID. */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Create a new empty request. */
export function newRequest(name = 'New Request'): ApiRequest {
  return {
    id: generateId(),
    name,
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    body: '',
    bodyType: 'none',
    auth: { type: 'none' },
  };
}

/** Determine if a content type is JSON. */
export function isJsonContentType(contentType: string): boolean {
  return contentType.includes('json') || contentType.includes('javascript');
}

/** Try to pretty-print JSON. Returns original if not valid JSON. */
export function prettyJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
