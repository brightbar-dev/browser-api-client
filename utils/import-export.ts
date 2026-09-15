/** Import/export Postman v2.1 format and native format. */

import type { ApiRequest, AuthConfig, KeyValuePair, HttpMethod, MultipartField } from './request';
import type { Collection, CollectionFolder } from './collections';
import type { Environment, EnvVariable } from './environment';
import type { ImportResult } from './curl-import';
import { generateId, newRequest } from './request';
import { newCollection } from './collections';
import { headerValue, isJsonMediaType, mediaTypeOf, queryParamsFromUrl, reattachWarning } from './curl-import';

// --- Postman v2.1 types (subset) ---

interface PostmanCollection {
  info: {
    name: string;
    description?: string | { content?: string };
    schema: string;
  };
  item: PostmanItem[];
  variable?: PostmanVariable[];
  auth?: PostmanAuth;
  event?: unknown[];
}

/** A request item, or a folder when `item` is present. */
interface PostmanItem {
  name: string;
  request?: PostmanRequest | string;
  item?: PostmanItem[];
  auth?: PostmanAuth;
  event?: unknown[];
}

interface PostmanRequest {
  method: string;
  header?: PostmanHeader[] | string;
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
  protocol?: string;
  host?: string[] | string;
  port?: string;
  path?: string[] | string;
  query?: PostmanQuery[];
  hash?: string;
}

interface PostmanQuery {
  key: string;
  value: string | null;
  disabled?: boolean;
}

interface PostmanFormParam {
  key: string;
  value?: string;
  type?: 'text' | 'file';
  src?: string | string[] | null;
  disabled?: boolean;
  contentType?: string;
}

interface PostmanBody {
  mode: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
  raw?: string;
  urlencoded?: Array<{ key: string; value?: string; disabled?: boolean }>;
  formdata?: PostmanFormParam[];
  file?: { src?: string | null };
  graphql?: { query?: string; variables?: string | object };
  options?: { raw?: { language?: string } };
  disabled?: boolean;
}

type PostmanAuthParams = Array<{ key: string; value: unknown; type?: string }> | Record<string, unknown>;

interface PostmanAuth {
  type: string;
  bearer?: PostmanAuthParams;
  basic?: PostmanAuthParams;
  apikey?: PostmanAuthParams;
  oauth2?: PostmanAuthParams;
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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** Import a Postman Collection v2.1 JSON into our format. See importPostmanCollectionDetailed. */
export function importPostmanCollection(json: string): Collection {
  return importPostmanCollectionDetailed(json).value;
}

/**
 * Import a Postman Collection (v2.1, and v2.0 auth shapes) with warnings.
 *
 * - Top-level folders become `folders`. Deeper folders flatten into their top-level folder,
 *   with request names prefixed by the sub-folder path: `Sub / Deeper / Name`.
 * - Request URLs keep their query string; `params` mirrors it plus disabled query rows.
 * - Auth is inherited from the folder and collection when a request has none.
 * - File fields and file bodies come through without their files, with a warning each.
 * - Collection variables are NOT returned; a warning names them so they can be added to an
 *   environment (their values may be secrets, so they are not echoed).
 * - Pre-request and test scripts are dropped with one warning.
 *
 * Throws an Error with a user-facing message only when the text is not JSON.
 */
export function importPostmanCollectionDetailed(json: string): ImportResult<Collection> {
  let data: PostmanCollection;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`The collection is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const warnings = new Set<string>();
  const info = isObj(data) && isObj(data.info) ? data.info : undefined;
  const collection = newCollection(str(info?.name) || 'Imported Collection');
  const description = info?.description;
  collection.description = typeof description === 'string' ? description : isObj(description) ? str(description.content) : '';

  const items = isObj(data) && Array.isArray(data.item) ? data.item : [];
  const rootAuth = isObj(data) && isObj(data.auth) ? data.auth : undefined;
  let sawScripts = hasScripts(isObj(data) ? data.event : undefined);
  const folders: CollectionFolder[] = [];

  const collect = (list: PostmanItem[], prefix: string, inherited: PostmanAuth | undefined, into: ApiRequest[]) => {
    for (const item of list) {
      if (!isObj(item)) continue;
      if (hasScripts(item.event)) sawScripts = true;
      const auth = effectiveAuth(item.auth, inherited);
      if (Array.isArray(item.item)) {
        collect(item.item, `${prefix}${str(item.name) || 'Folder'} / `, auth, into);
      } else if (item.request !== undefined) {
        into.push(postmanItemToRequest(item, `${prefix}${str(item.name) || 'Imported Request'}`, inherited, warnings));
      }
    }
  };

  for (const item of items) {
    if (!isObj(item)) continue;
    if (Array.isArray(item.item)) {
      if (hasScripts(item.event)) sawScripts = true;
      const folder: CollectionFolder = { id: generateId(), name: str(item.name) || 'Folder', requests: [] };
      collect(item.item, '', effectiveAuth(item.auth, rootAuth), folder.requests);
      folders.push(folder);
    } else {
      collect([item], '', rootAuth, collection.requests);
    }
  }
  collection.folders = folders;

  const variables = isObj(data) && Array.isArray(data.variable) ? data.variable : [];
  const names = variables.map(v => (isObj(v) ? str(v.key) : '')).filter(Boolean);
  if (names.length > 0) {
    warnings.add(`The collection defines variables that were not imported: ${names.join(', ')}. Add them to an environment.`);
  }
  if (sawScripts) warnings.add('Pre-request and test scripts are not imported.');

  return { value: collection, warnings: [...warnings] };
}

function hasScripts(events: unknown): boolean {
  return Array.isArray(events) && events.some(e => isObj(e) && isObj(e.script) && Array.isArray(e.script.exec) && e.script.exec.some(line => str(line).trim() !== ''));
}

/** A request's own auth, unless it is missing or `inherit`. */
function effectiveAuth(own: PostmanAuth | undefined, inherited: PostmanAuth | undefined): PostmanAuth | undefined {
  if (!isObj(own) || own.type === 'inherit') return inherited;
  return own;
}

function postmanItemToRequest(item: PostmanItem, name: string, inheritedAuth: PostmanAuth | undefined, warnings: Set<string>): ApiRequest {
  const pr: PostmanRequest = typeof item.request === 'string' ? { method: 'GET', url: item.request } : isObj(item.request) ? item.request : { method: 'GET', url: '' };
  const req = newRequest(name);
  req.method = normalizeMethod(str(pr.method) || 'GET');

  // URL: kept as typed, including its query. Disabled query rows exist only in params.
  let url = '';
  let query: PostmanQuery[] | undefined;
  if (typeof pr.url === 'string') {
    url = pr.url;
  } else if (isObj(pr.url)) {
    url = str(pr.url.raw) || urlFromParts(pr.url);
    if (Array.isArray(pr.url.query)) query = pr.url.query.filter(isObj);
  }
  if (query && query.length > 0) {
    const enabled = query.filter(q => !q.disabled);
    const hashAt = url.indexOf('#');
    const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
    if (!beforeHash.includes('?') && enabled.length > 0) {
      const text = enabled.map(q => (q.value === null || q.value === undefined ? str(q.key) : `${str(q.key)}=${str(q.value)}`)).join('&');
      url = `${beforeHash}?${text}${hashAt === -1 ? '' : url.slice(hashAt)}`;
    }
    req.params = query.map(q => ({ key: str(q.key), value: str(q.value), enabled: !q.disabled }));
  } else {
    req.params = queryParamsFromUrl(url);
  }
  req.url = url;

  // Headers
  if (Array.isArray(pr.header)) {
    req.headers = pr.header.filter(isObj).map(h => ({ key: str(h.key), value: str(h.value), enabled: !h.disabled }));
  } else if (typeof pr.header === 'string') {
    req.headers = pr.header
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.includes(':'))
      .map(line => {
        const colon = line.indexOf(':');
        return { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim(), enabled: true };
      });
  }

  req.auth = postmanAuthToAuth(effectiveAuth(pr.auth, inheritedAuth), name, warnings);
  applyPostmanBody(req, pr.body, name, warnings);
  return req;
}

function urlFromParts(u: PostmanUrl): string {
  const host = Array.isArray(u.host) ? u.host.join('.') : str(u.host);
  const path = Array.isArray(u.path) ? u.path.join('/') : str(u.path).replace(/^\//, '');
  let url = u.protocol ? `${u.protocol}://${host}` : host;
  if (u.port) url += `:${u.port}`;
  if (path) url += `/${path}`;
  return url;
}

const RAW_LANGUAGE_TYPES: Record<string, string> = {
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
  text: 'text/plain',
};

function applyPostmanBody(req: ApiRequest, body: PostmanBody | undefined, name: string, warnings: Set<string>): void {
  if (!isObj(body) || body.disabled) return;
  switch (body.mode) {
    case 'raw': {
      const raw = str(body.raw);
      if (!raw) return;
      req.body = raw;
      const lang = str(body.options?.raw?.language).toLowerCase();
      if (lang === 'json' || (!lang && isJsonMediaType(mediaTypeOf(headerValue(req.headers, 'content-type') ?? '')))) {
        req.bodyType = 'json';
      } else {
        req.bodyType = 'text';
        req.textContentType = RAW_LANGUAGE_TYPES[lang] ?? (headerValue(req.headers, 'content-type') || 'text/plain');
      }
      return;
    }
    case 'urlencoded':
      req.bodyType = 'form';
      req.formFields = (Array.isArray(body.urlencoded) ? body.urlencoded : [])
        .filter(isObj)
        .map(f => ({ key: str(f.key), value: str(f.value), enabled: !f.disabled }));
      return;
    case 'formdata':
      req.bodyType = 'multipart';
      req.multipartFields = (Array.isArray(body.formdata) ? body.formdata : []).filter(isObj).map((f): MultipartField => {
        if (f.type !== 'file') return { key: str(f.key), value: str(f.value), enabled: !f.disabled, kind: 'text' };
        warnings.add(`${reattachWarning(str(f.key))} (${name})`);
        const src = Array.isArray(f.src) ? str(f.src[0]) : str(f.src);
        return { key: str(f.key), value: src.split(/[\\/]/).pop() ?? '', enabled: !f.disabled, kind: 'file' };
      });
      return;
    case 'file':
      req.bodyType = 'binary';
      warnings.add(`The file body of "${name}" was not imported. Choose the file again before sending.`);
      return;
    case 'graphql': {
      const gql = isObj(body.graphql) ? body.graphql : {};
      req.bodyType = 'graphql';
      req.body = str(gql.query);
      const vars = gql.variables;
      req.graphqlVariables = typeof vars === 'string' ? vars : isObj(vars) ? JSON.stringify(vars, null, 2) : '';
      return;
    }
  }
}

function normalizeMethod(m: string): HttpMethod {
  const upper = m.toUpperCase();
  const valid: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  return valid.includes(upper as HttpMethod) ? (upper as HttpMethod) : 'GET';
}

/** Read one auth parameter from the v2.1 array form or the v2.0 object form. */
function authParam(params: PostmanAuthParams | undefined, key: string): string | undefined {
  if (Array.isArray(params)) {
    const found = params.find(p => isObj(p) && p.key === key);
    return found ? str(found.value) : undefined;
  }
  if (isObj(params) && params[key] !== undefined) return str(params[key]);
  return undefined;
}

function postmanAuthToAuth(auth: PostmanAuth | undefined, name: string, warnings: Set<string>): AuthConfig {
  if (!isObj(auth) || auth.type === 'noauth') return { type: 'none' };

  if (auth.type === 'bearer') {
    return { type: 'bearer', token: authParam(auth.bearer, 'token') ?? '' };
  }

  if (auth.type === 'basic') {
    return { type: 'basic', username: authParam(auth.basic, 'username') ?? '', password: authParam(auth.basic, 'password') ?? '' };
  }

  if (auth.type === 'apikey') {
    const result: AuthConfig = {
      type: 'api-key',
      headerName: authParam(auth.apikey, 'key') || 'X-API-Key',
      headerValue: authParam(auth.apikey, 'value') ?? '',
    };
    if (authParam(auth.apikey, 'in') === 'query') result.apiKeyIn = 'query';
    return result;
  }

  if (auth.type === 'oauth2') {
    const token = authParam(auth.oauth2, 'accessToken');
    warnings.add(`OAuth 2 settings on "${name}" are not supported${token !== undefined ? '; its access token was imported as a bearer token' : ''}.`);
    return token !== undefined ? { type: 'bearer', token } : { type: 'none' };
  }

  warnings.add(`The ${str(auth.type)} auth on "${name}" is not supported, so it was imported without auth.`);
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

/** Export a collection as Postman v2.1 JSON. Folders come first, then top-level requests. */
export function exportToPostman(collection: Collection): string {
  const postman: PostmanCollection = {
    info: {
      name: collection.name,
      description: collection.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      ...(collection.folders ?? []).map(f => ({ name: f.name, item: f.requests.map(requestToPostmanItem) })),
      ...collection.requests.map(requestToPostmanItem),
    ],
  };

  return JSON.stringify(postman, null, 2);
}

/** Split a URL as typed into Postman's parts, so tools that ignore `raw` still get host and path. */
function postmanUrl(raw: string, params: KeyValuePair[]): PostmanUrl {
  const url: PostmanUrl = { raw };
  let rest = raw;
  const hashAt = rest.indexOf('#');
  if (hashAt !== -1) {
    url.hash = rest.slice(hashAt + 1);
    rest = rest.slice(0, hashAt);
  }
  const q = rest.indexOf('?');
  if (q !== -1) rest = rest.slice(0, q);
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  if (scheme?.[1]) {
    url.protocol = scheme[1];
    rest = rest.slice(scheme[0].length);
  }
  const slash = rest.indexOf('/');
  let authority = slash === -1 ? rest : rest.slice(0, slash);
  const port = /:(\d+|\{\{\w+\}\})$/.exec(authority);
  if (port?.[1]) {
    url.port = port[1];
    authority = authority.slice(0, port.index);
  }
  if (authority) url.host = authority.split('.');
  if (slash !== -1) url.path = rest.slice(slash + 1).split('/');
  const query = params.filter(p => p.key).map(p => ({ key: p.key, value: p.value, disabled: !p.enabled }));
  if (query.length > 0) url.query = query;
  return url;
}

function requestToPostmanItem(req: ApiRequest): PostmanItem {
  const headers: PostmanHeader[] = req.headers
    .filter(h => h.key)
    .map(h => ({ key: h.key, value: h.value, disabled: !h.enabled }));

  const request: PostmanRequest = {
    method: req.method,
    header: headers.length > 0 ? headers : undefined,
    url: postmanUrl(req.url, req.params),
  };

  const body = bodyToPostman(req);
  if (body) request.body = body;

  if (req.auth.type !== 'none') {
    request.auth = authToPostmanAuth(req.auth);
  }

  return { name: req.name, request };
}

function textLanguage(contentType: string | undefined): string {
  const mt = mediaTypeOf(contentType ?? '');
  if (mt.includes('xml')) return 'xml';
  if (mt === 'text/html') return 'html';
  if (mt.includes('javascript')) return 'javascript';
  if (isJsonMediaType(mt)) return 'json';
  return 'text';
}

function bodyToPostman(req: ApiRequest): PostmanBody | undefined {
  switch (req.bodyType) {
    case 'json':
      return req.body ? { mode: 'raw', raw: req.body, options: { raw: { language: 'json' } } } : undefined;
    case 'text':
      return req.body ? { mode: 'raw', raw: req.body, options: { raw: { language: textLanguage(req.textContentType) } } } : undefined;
    case 'form':
      return {
        mode: 'urlencoded',
        urlencoded: (req.formFields ?? []).map(f => ({ key: f.key, value: f.value, disabled: !f.enabled })),
      };
    case 'multipart':
      return {
        mode: 'formdata',
        formdata: (req.multipartFields ?? []).map((f): PostmanFormParam =>
          f.kind === 'file'
            ? { key: f.key, type: 'file', src: f.file?.name ?? f.value, disabled: !f.enabled }
            : { key: f.key, value: f.value, type: 'text', disabled: !f.enabled },
        ),
      };
    case 'graphql':
      return { mode: 'graphql', graphql: { query: req.body, variables: req.graphqlVariables ?? '' } };
    case 'binary':
      return { mode: 'file', file: { src: req.binaryFile?.name ?? '' } };
    default:
      return undefined;
  }
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
          { key: 'in', value: auth.apiKeyIn === 'query' ? 'query' : 'header' },
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
    values: env.variables.map((v: EnvVariable) => ({
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
