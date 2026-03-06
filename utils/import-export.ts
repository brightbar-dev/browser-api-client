/** Import/export Postman v2.1 format and native format. */

import type { ApiRequest, AuthConfig, KeyValuePair, HttpMethod } from './request';
import type { Collection } from './collections';
import type { Environment, EnvVariable } from './environment';
import { generateId } from './request';
import { newCollection } from './collections';

// --- Postman v2.1 types (subset) ---

interface PostmanCollection {
  info: {
    name: string;
    description?: string;
    schema: string;
  };
  item: PostmanItem[];
  variable?: PostmanVariable[];
}

interface PostmanItem {
  name: string;
  request: PostmanRequest;
}

interface PostmanRequest {
  method: string;
  header?: PostmanHeader[];
  url: PostmanUrl | string;
  body?: PostmanBody;
  auth?: PostmanAuth;
  description?: string;
}

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanUrl {
  raw: string;
  host?: string[];
  path?: string[];
  query?: PostmanQuery[];
  protocol?: string;
}

interface PostmanQuery {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanBody {
  mode: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
  raw?: string;
  options?: { raw?: { language?: string } };
}

interface PostmanAuth {
  type: 'bearer' | 'basic' | 'apikey' | 'noauth';
  bearer?: Array<{ key: string; value: string }>;
  basic?: Array<{ key: string; value: string }>;
  apikey?: Array<{ key: string; value: string }>;
}

interface PostmanVariable {
  key: string;
  value: string;
}

interface PostmanEnvironment {
  name: string;
  values: Array<{
    key: string;
    value: string;
    enabled: boolean;
  }>;
}

// --- Import from Postman ---

/** Import a Postman Collection v2.1 JSON into our format. */
export function importPostmanCollection(json: string): Collection {
  const data: PostmanCollection = JSON.parse(json);
  const collection = newCollection(data.info?.name || 'Imported Collection');
  collection.description = data.info?.description || '';

  if (data.item && Array.isArray(data.item)) {
    collection.requests = data.item
      .filter(item => item.request)
      .map(item => postmanItemToRequest(item));
  }

  return collection;
}

function postmanItemToRequest(item: PostmanItem): ApiRequest {
  const pr = item.request;

  // URL
  let url = '';
  const params: KeyValuePair[] = [];
  if (typeof pr.url === 'string') {
    url = pr.url;
  } else if (pr.url) {
    url = pr.url.raw || '';
    if (pr.url.query) {
      for (const q of pr.url.query) {
        params.push({ key: q.key, value: q.value, enabled: !q.disabled });
      }
    }
  }

  // Strip query string from URL if we extracted params
  if (params.length > 0 && url.includes('?')) {
    url = url.split('?')[0];
  }

  // Method
  const method = normalizeMethod(pr.method || 'GET');

  // Headers
  const headers: KeyValuePair[] = (pr.header || []).map(h => ({
    key: h.key,
    value: h.value,
    enabled: !h.disabled,
  }));

  // Auth
  const auth = postmanAuthToAuth(pr.auth);

  // Body
  let body = '';
  let bodyType: ApiRequest['bodyType'] = 'none';
  if (pr.body) {
    if (pr.body.mode === 'raw' && pr.body.raw) {
      body = pr.body.raw;
      const lang = pr.body.options?.raw?.language;
      bodyType = lang === 'json' ? 'json' : 'text';
    } else if (pr.body.mode === 'urlencoded') {
      bodyType = 'form';
    }
  }

  return {
    id: generateId(),
    name: item.name || 'Imported Request',
    method,
    url,
    headers,
    params,
    body,
    bodyType,
    auth,
  };
}

function normalizeMethod(m: string): HttpMethod {
  const upper = m.toUpperCase();
  const valid: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  return valid.includes(upper as HttpMethod) ? (upper as HttpMethod) : 'GET';
}

function postmanAuthToAuth(auth?: PostmanAuth): AuthConfig {
  if (!auth || auth.type === 'noauth') return { type: 'none' };

  if (auth.type === 'bearer' && auth.bearer) {
    const token = auth.bearer.find(b => b.key === 'token')?.value || '';
    return { type: 'bearer', token };
  }

  if (auth.type === 'basic' && auth.basic) {
    const username = auth.basic.find(b => b.key === 'username')?.value || '';
    const password = auth.basic.find(b => b.key === 'password')?.value || '';
    return { type: 'basic', username, password };
  }

  if (auth.type === 'apikey' && auth.apikey) {
    const headerName = auth.apikey.find(b => b.key === 'key')?.value || 'X-API-Key';
    const headerValue = auth.apikey.find(b => b.key === 'value')?.value || '';
    return { type: 'api-key', headerName, headerValue };
  }

  return { type: 'none' };
}

/** Import a Postman Environment JSON. */
export function importPostmanEnvironment(json: string): Environment {
  const data: PostmanEnvironment = JSON.parse(json);
  return {
    id: generateId(),
    name: data.name || 'Imported Environment',
    variables: (data.values || []).map(v => ({
      key: v.key,
      value: v.value,
      enabled: v.enabled !== false,
    })),
  };
}

// --- Export to Postman ---

/** Export a collection as Postman v2.1 JSON. */
export function exportToPostman(collection: Collection): string {
  const postman: PostmanCollection = {
    info: {
      name: collection.name,
      description: collection.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: collection.requests.map(requestToPostmanItem),
  };

  return JSON.stringify(postman, null, 2);
}

function requestToPostmanItem(req: ApiRequest): PostmanItem {
  const headers: PostmanHeader[] = req.headers
    .filter(h => h.key)
    .map(h => ({ key: h.key, value: h.value, disabled: !h.enabled }));

  const query: PostmanQuery[] = req.params
    .filter(p => p.key)
    .map(p => ({ key: p.key, value: p.value, disabled: !p.enabled }));

  const url: PostmanUrl = {
    raw: req.url + (query.length > 0 ? '?' + query.filter(q => !q.disabled).map(q => `${q.key}=${q.value}`).join('&') : ''),
    query: query.length > 0 ? query : undefined,
  };

  const item: PostmanItem = {
    name: req.name,
    request: {
      method: req.method,
      header: headers.length > 0 ? headers : undefined,
      url,
    },
  };

  // Body
  if (req.body && req.bodyType !== 'none') {
    item.request.body = {
      mode: 'raw',
      raw: req.body,
      options: req.bodyType === 'json' ? { raw: { language: 'json' } } : undefined,
    };
  }

  // Auth
  if (req.auth.type !== 'none') {
    item.request.auth = authToPostmanAuth(req.auth);
  }

  return item;
}

function authToPostmanAuth(auth: AuthConfig): PostmanAuth {
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', bearer: [{ key: 'token', value: auth.token || '' }] };
    case 'basic':
      return {
        type: 'basic',
        basic: [
          { key: 'username', value: auth.username || '' },
          { key: 'password', value: auth.password || '' },
        ],
      };
    case 'api-key':
      return {
        type: 'apikey',
        apikey: [
          { key: 'key', value: auth.headerName || '' },
          { key: 'value', value: auth.headerValue || '' },
        ],
      };
    default:
      return { type: 'noauth' };
  }
}

/** Export an environment as Postman format. */
export function exportEnvironmentToPostman(env: Environment): string {
  const postman: PostmanEnvironment = {
    name: env.name,
    values: env.variables.map(v => ({
      key: v.key,
      value: v.value,
      enabled: v.enabled,
    })),
  };
  return JSON.stringify(postman, null, 2);
}

// --- Native format ---

export interface NativeExport {
  version: 1;
  collections: Collection[];
  environments: Environment[];
  exportedAt: string;
}

/** Export collections and environments as native JSON. */
export function exportNative(collections: Collection[], environments: Environment[]): string {
  const data: NativeExport = {
    version: 1,
    collections,
    environments,
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(data, null, 2);
}

/** Import native format. Returns null if invalid. */
export function importNative(json: string): NativeExport | null {
  try {
    const data = JSON.parse(json);
    if (data.version !== 1) return null;
    if (!Array.isArray(data.collections) || !Array.isArray(data.environments)) return null;
    return data as NativeExport;
  } catch {
    return null;
  }
}

/** Detect if a JSON string is Postman or native format. */
export function detectFormat(json: string): 'postman-collection' | 'postman-environment' | 'native' | 'unknown' {
  try {
    const data = JSON.parse(json);
    if (data.version === 1 && data.collections) return 'native';
    if (data.info?.schema?.includes('getpostman.com')) return 'postman-collection';
    if (data.values && Array.isArray(data.values) && data.name) return 'postman-environment';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
