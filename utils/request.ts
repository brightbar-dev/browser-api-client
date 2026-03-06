/** HTTP request building and parsing utilities. */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface KeyValuePair {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValuePair[];
  params: KeyValuePair[];
  body: string;
  bodyType: 'none' | 'json' | 'form' | 'text';
  auth: AuthConfig;
}

export interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'api-key';
  token?: string;
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  size: number;
  time: number;
  contentType: string;
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
        const encoded = btoa(`${auth.username}:${auth.password || ''}`);
        result['Authorization'] = `Basic ${encoded}`;
      }
      break;
    case 'api-key':
      if (auth.headerName && auth.headerValue) {
        result[auth.headerName] = auth.headerValue;
      }
      break;
  }

  return result;
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
    headers: [{ key: '', value: '', enabled: true }],
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
