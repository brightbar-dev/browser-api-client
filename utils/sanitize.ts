/**
 * Validate data that comes from outside the running code — storage written by an older
 * version, backup files, imports — into well-formed models. Unknown fields are dropped;
 * nothing here throws.
 */

import type { ApiRequest, ApiResponse, AuthConfig, BodyType, FileRef, HttpMethod, KeyValuePair, MultipartField } from './request';
import { HTTP_METHODS, generateId } from './request';
import type { Environment, EnvVariable } from './environment';
import type { Collection, CollectionFolder } from './collections';
import type { HistoryEntry } from './history';

const MAX_ROWS = 500;
const BODY_TYPES: BodyType[] = ['none', 'json', 'form', 'multipart', 'text', 'binary', 'graphql'];
const AUTH_TYPES: AuthConfig['type'][] = ['none', 'bearer', 'basic', 'api-key'];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function id(v: unknown): string {
  return typeof v === 'string' && v ? v : generateId();
}

export function sanitizeKeyValues(v: unknown): KeyValuePair[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_ROWS)
    .filter(isObj)
    .map(row => ({ key: str(row.key), value: str(row.value), enabled: typeof row.enabled === 'boolean' ? row.enabled : true }));
}

function sanitizeFileRef(v: unknown): FileRef | undefined {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return undefined;
  return { id: v.id, name: str(v.name, 'file'), size: Math.max(0, num(v.size)), type: str(v.type) };
}

function sanitizeMultipart(v: unknown): MultipartField[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_ROWS)
    .filter(isObj)
    .map(row => {
      const field: MultipartField = {
        key: str(row.key),
        value: str(row.value),
        enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
        kind: row.kind === 'file' ? 'file' : 'text',
      };
      const file = sanitizeFileRef(row.file);
      if (field.kind === 'file' && file) field.file = file;
      return field;
    });
}

function sanitizeAuth(v: unknown): AuthConfig {
  if (!isObj(v)) return { type: 'none' };
  const type = AUTH_TYPES.includes(v.type as AuthConfig['type']) ? (v.type as AuthConfig['type']) : 'none';
  const auth: AuthConfig = { type };
  for (const key of ['token', 'username', 'password', 'headerName', 'headerValue'] as const) {
    const value = optStr(v[key]);
    if (value !== undefined) auth[key] = value;
  }
  if (v.apiKeyIn === 'query' || v.apiKeyIn === 'header') auth.apiKeyIn = v.apiKeyIn;
  return auth;
}

export function sanitizeRequest(v: unknown): ApiRequest | null {
  if (!isObj(v)) return null;
  const method = str(v.method, 'GET').toUpperCase();
  const req: ApiRequest = {
    id: id(v.id),
    name: str(v.name, 'New Request'),
    method: HTTP_METHODS.includes(method as HttpMethod) ? (method as HttpMethod) : 'GET',
    url: str(v.url),
    headers: sanitizeKeyValues(v.headers),
    params: sanitizeKeyValues(v.params),
    body: str(v.body),
    bodyType: BODY_TYPES.includes(v.bodyType as BodyType) ? (v.bodyType as BodyType) : 'none',
    auth: sanitizeAuth(v.auth),
  };
  const textContentType = optStr(v.textContentType);
  if (textContentType) req.textContentType = textContentType;
  if (Array.isArray(v.formFields)) req.formFields = sanitizeKeyValues(v.formFields);
  if (Array.isArray(v.multipartFields)) req.multipartFields = sanitizeMultipart(v.multipartFields);
  const binaryFile = sanitizeFileRef(v.binaryFile);
  if (binaryFile) req.binaryFile = binaryFile;
  const graphqlVariables = optStr(v.graphqlVariables);
  if (graphqlVariables !== undefined) req.graphqlVariables = graphqlVariables;
  return req;
}

export function sanitizeEnvironment(v: unknown): Environment | null {
  if (!isObj(v)) return null;
  const variables: EnvVariable[] = Array.isArray(v.variables)
    ? v.variables.slice(0, MAX_ROWS).filter(isObj).map(row => {
        const variable: EnvVariable = {
          key: str(row.key),
          value: str(row.value),
          enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
        };
        if (row.secret === true) variable.secret = true;
        return variable;
      })
    : [];
  return { id: id(v.id), name: str(v.name, 'Environment'), variables };
}

function sanitizeRequests(v: unknown): ApiRequest[] {
  return Array.isArray(v) ? v.map(sanitizeRequest).filter((r): r is ApiRequest => r !== null) : [];
}

/** A folder must be an object; its id, name and requests are filled or sanitized. */
function sanitizeFolder(v: unknown): CollectionFolder | null {
  if (!isObj(v)) return null;
  return { id: id(v.id), name: str(v.name, 'Folder'), requests: sanitizeRequests(v.requests) };
}

export function sanitizeCollection(v: unknown): Collection | null {
  if (!isObj(v)) return null;
  const now = Date.now();
  const folders = Array.isArray(v.folders)
    ? v.folders.map(sanitizeFolder).filter((f): f is CollectionFolder => f !== null)
    : undefined;
  return {
    id: id(v.id),
    name: str(v.name, 'Collection'),
    description: str(v.description),
    requests: sanitizeRequests(v.requests),
    ...(folders ? { folders } : {}),
    created: num(v.created, now),
    updated: num(v.updated, now),
  };
}

function sanitizeResponse(v: unknown): ApiResponse {
  const r = isObj(v) ? v : {};
  const headers: Record<string, string> = {};
  if (isObj(r.headers)) {
    for (const [k, val] of Object.entries(r.headers)) {
      if (typeof val === 'string') headers[k] = val;
    }
  }
  return {
    status: num(r.status),
    statusText: str(r.statusText),
    headers,
    body: str(r.body),
    size: num(r.size),
    time: num(r.time),
    contentType: str(r.contentType),
  };
}

export function sanitizeHistoryEntry(v: unknown): HistoryEntry | null {
  if (!isObj(v)) return null;
  const request = sanitizeRequest(v.request);
  if (!request) return null;
  return { id: id(v.id), request, response: sanitizeResponse(v.response), timestamp: num(v.timestamp, Date.now()) };
}

/** Map a list through a sanitizer, counting what had to be dropped. */
export function sanitizeList<T>(v: unknown, fn: (item: unknown) => T | null): { items: T[]; dropped: number } {
  if (!Array.isArray(v)) return { items: [], dropped: 0 };
  const items: T[] = [];
  let dropped = 0;
  for (const item of v) {
    const clean = fn(item);
    if (clean) items.push(clean);
    else dropped++;
  }
  return { items, dropped };
}
