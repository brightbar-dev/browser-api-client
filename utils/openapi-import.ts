/**
 * Import an OpenAPI 3.x or Swagger 2.0 document (JSON only) as a collection plus the
 * environment variables its requests use.
 *
 * - One folder per operation's first tag; untagged operations sit at the collection root.
 * - URLs are `{{baseUrl}}` + the path, with `{param}` → `{{param}}` (non-word characters in
 *   the name become `_`, because `{{…}}` only matches word characters).
 * - Bodies come from examples or from a sample generated from the schema.
 * - Anything that cannot be carried over becomes a warning. A missing or malformed optional
 *   field never throws; only input that is not an OpenAPI/Swagger JSON document does.
 */

import type { ApiRequest, AuthConfig, HttpMethod, KeyValuePair, MultipartField } from './request';
import type { Collection, CollectionFolder } from './collections';
import type { EnvVariable } from './environment';
import type { ImportResult } from './curl-import';
import { generateId, newRequest } from './request';
import { newCollection } from './collections';
import { isJsonMediaType, mediaTypeOf } from './curl-import';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asObj = (v: unknown): Json | undefined => (isObj(v) ? v : undefined);
const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const MAX_SAMPLE_DEPTH = 10;
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

interface Ctx {
  doc: Json;
  v2: boolean;
  warnings: Set<string>;
  variables: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Input and references
// ---------------------------------------------------------------------------

function parseInput(input: string | object): Json {
  if (typeof input !== 'string') {
    if (!isObj(input)) throw new Error('Paste an OpenAPI or Swagger document (a JSON object).');
    return input;
  }
  const text = input.replace(/^﻿/, '').trim();
  if (!text) throw new Error('Paste an OpenAPI or Swagger document.');
  if (!text.startsWith('{') && !text.startsWith('[')) {
    if (/^(---|%YAML|[^\s#{[][^:\n]*:(\s|$))/m.test(text)) {
      throw new Error('This looks like YAML. Paste the JSON form of the spec (most tools can export it).');
    }
    throw new Error('This is not JSON. Paste the JSON form of the OpenAPI or Swagger document.');
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`The document is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isObj(data)) throw new Error('Paste an OpenAPI or Swagger document (a JSON object).');
  return data;
}

function pointer(doc: Json, ref: string): unknown {
  let node: unknown = doc;
  for (const raw of ref.slice(2).split('/')) {
    let key = raw;
    try {
      key = decodeURIComponent(raw);
    } catch {
      // keep raw
    }
    key = key.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(node)) node = node[Number(key)];
    else if (isObj(node)) node = node[key];
    else return undefined;
  }
  return node;
}

/** Follow local `$ref`s until a non-reference value. External or broken refs warn and give undefined. */
function resolve(ctx: Ctx, value: unknown): unknown {
  let cur = value;
  const seen = new Set<string>();
  while (isObj(cur) && typeof cur.$ref === 'string') {
    const ref = cur.$ref;
    if (!ref.startsWith('#/')) {
      ctx.warnings.add(`External references are not followed: ${ref}`);
      return undefined;
    }
    if (seen.has(ref)) return undefined;
    seen.add(ref);
    cur = pointer(ctx.doc, ref);
    if (cur === undefined) {
      ctx.warnings.add(`A reference points at nothing: ${ref}`);
      return undefined;
    }
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Sample values
// ---------------------------------------------------------------------------

const STRING_SAMPLES: Record<string, string> = {
  'date-time': '2024-01-01T00:00:00Z',
  date: '2024-01-01',
  time: '12:00:00Z',
  duration: 'P1D',
  email: 'user@example.com',
  'idn-email': 'user@example.com',
  uuid: '00000000-0000-4000-8000-000000000000',
  uri: 'https://example.com',
  url: 'https://example.com',
  'uri-reference': '/example',
  hostname: 'example.com',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  byte: 'ZXhhbXBsZQ==',
  binary: '',
  password: 'password',
};

function schemaType(s: Json): string | undefined {
  if (typeof s.type === 'string') return s.type;
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t): t is string => typeof t === 'string');
    return types.find(t => t !== 'null') ?? types[0];
  }
  if (isObj(s.properties) || s.additionalProperties !== undefined) return 'object';
  if (s.items !== undefined) return 'array';
  return undefined;
}

/**
 * A plausible value for a schema: example, default, const, enum[0], then by type.
 * `chain` holds the refs being expanded, so a recursive schema stops instead of looping.
 */
function sample(ctx: Ctx, schemaIn: unknown, depth: number, chain: Set<string>): unknown {
  if (depth > MAX_SAMPLE_DEPTH || !isObj(schemaIn)) return undefined;
  if (typeof schemaIn.$ref === 'string') {
    const ref = schemaIn.$ref;
    if (chain.has(ref)) return undefined;
    chain.add(ref);
    const out = sample(ctx, resolve(ctx, schemaIn), depth + 1, chain);
    chain.delete(ref);
    return out;
  }
  const s = schemaIn;
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.examples) && s.examples.length > 0) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];

  if (Array.isArray(s.allOf) && s.allOf.length > 0) {
    let merged: Json | undefined;
    let other: unknown;
    for (const part of s.allOf) {
      const v = sample(ctx, part, depth + 1, chain);
      if (isObj(v)) merged = { ...merged, ...v };
      else if (v !== undefined) other = v;
    }
    if (isObj(s.properties)) merged = { ...merged, ...sampleObject(ctx, s, depth, chain) };
    return merged ?? other;
  }
  const variants = asArr(s.oneOf).length > 0 ? asArr(s.oneOf) : asArr(s.anyOf);
  if (variants.length > 0) return sample(ctx, variants[0], depth + 1, chain);

  switch (schemaType(s)) {
    case 'object':
      return sampleObject(ctx, s, depth, chain);
    case 'array': {
      const item = sample(ctx, s.items, depth + 1, chain);
      return item === undefined ? [] : [item];
    }
    case 'string': {
      const format = asStr(s.format);
      return (format !== undefined ? STRING_SAMPLES[format] : undefined) ?? 'string';
    }
    case 'integer':
    case 'number':
      return typeof s.minimum === 'number' ? s.minimum : 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return undefined;
  }
}

function sampleObject(ctx: Ctx, s: Json, depth: number, chain: Set<string>): Json {
  const out: Json = {};
  for (const [name, prop] of Object.entries(asObj(s.properties) ?? {})) {
    const target = asObj(resolve(ctx, prop));
    if (target?.readOnly === true) continue; // not sent in requests
    const v = sample(ctx, prop, depth + 1, chain);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** Properties of an object schema, including those merged in through allOf. */
function schemaProperties(ctx: Ctx, schemaIn: unknown, depth = 0): Array<[string, unknown]> {
  const s = asObj(resolve(ctx, schemaIn));
  if (!s || depth > MAX_SAMPLE_DEPTH) return [];
  const props = new Map<string, unknown>();
  for (const part of asArr(s.allOf)) for (const [k, v] of schemaProperties(ctx, part, depth + 1)) props.set(k, v);
  for (const [k, v] of Object.entries(asObj(s.properties) ?? {})) props.set(k, v);
  return [...props];
}

function toText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(toText).join(',');
  return JSON.stringify(v);
}

/** Example for a parameter: example, examples, x-example, then schema example/default/enum[0]. */
function paramExample(ctx: Ctx, p: Json): unknown {
  if (p.example !== undefined) return p.example;
  for (const ex of Object.values(asObj(p.examples) ?? {})) {
    const value = asObj(resolve(ctx, ex))?.value;
    if (value !== undefined) return value;
  }
  if (p['x-example'] !== undefined) return p['x-example'];
  // Swagger 2 non-body parameters carry type/default/enum on the parameter itself.
  const schema = asObj(resolve(ctx, p.schema)) ?? p;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (p.default !== undefined) return p.default;
  const en = asArr(schema.enum);
  return en.length > 0 ? en[0] : undefined;
}

function mediaExample(ctx: Ctx, media: Json): unknown {
  if (media.example !== undefined) return media.example;
  for (const ex of Object.values(asObj(media.examples) ?? {})) {
    const value = asObj(resolve(ctx, ex))?.value;
    if (value !== undefined) return value;
  }
  return undefined;
}

function isBinarySchema(ctx: Ctx, schemaIn: unknown): boolean {
  const s = asObj(resolve(ctx, schemaIn));
  if (!s) return false;
  if (s.format === 'binary' || s.type === 'file' || s.contentMediaType !== undefined || s.contentEncoding !== undefined) return true;
  return schemaType(s) === 'array' && isBinarySchema(ctx, s.items);
}

// ---------------------------------------------------------------------------
// Variables, servers, security
// ---------------------------------------------------------------------------

const varName = (name: string) => name.replace(/\W/g, '_');

function addVariable(ctx: Ctx, key: string, value: string): void {
  const existing = ctx.variables.get(key);
  if (existing === undefined || (existing === '' && value !== '')) ctx.variables.set(key, value);
}

function serverUrl(server: unknown): string | undefined {
  const s = asObj(server);
  const url = asStr(s?.url);
  if (url === undefined) return undefined;
  const vars = asObj(s?.variables) ?? {};
  return url
    .replace(/\{([^}]+)\}/g, (match, name: string) => {
      const v = asObj(vars[name]);
      const value = v?.default ?? asArr(v?.enum)[0];
      return value !== undefined ? String(value) : match;
    })
    .replace(/\/+$/, '');
}

function baseUrl(ctx: Ctx): string {
  const { doc } = ctx;
  if (ctx.v2) {
    const host = asStr(doc.host);
    const basePath = (asStr(doc.basePath) ?? '').replace(/\/+$/, '');
    if (!host) {
      ctx.warnings.add('The spec has no host, so baseUrl may need a scheme and host.');
      return basePath;
    }
    const scheme = asStr(asArr(doc.schemes)[0]) ?? 'https';
    return `${scheme}://${host}${basePath}`;
  }
  const url = serverUrl(asArr(doc.servers)[0]);
  if (url === undefined) {
    ctx.warnings.add('The spec lists no servers. Set the baseUrl variable before sending.');
    return '';
  }
  return url;
}

interface AuthChoice {
  auth: AuthConfig;
  vars: string[];
  /** Set when this is a stand-in (OAuth 2 as a bearer token), used only if nothing better exists. */
  fallbackWarning?: string;
}

const BEARER: AuthChoice = { auth: { type: 'bearer', token: '{{bearerToken}}' }, vars: ['bearerToken'] };
const BASIC: AuthChoice = { auth: { type: 'basic', username: '{{username}}', password: '{{password}}' }, vars: ['username', 'password'] };

function mapScheme(name: string, scheme: Json): AuthChoice | string {
  const type = asStr(scheme.type)?.toLowerCase();
  if (type === 'http') {
    const s = asStr(scheme.scheme)?.toLowerCase();
    if (s === 'bearer') return BEARER;
    if (s === 'basic') return BASIC;
    return `HTTP ${asStr(scheme.scheme) ?? ''} authentication ("${name}") is not supported.`;
  }
  if (type === 'basic') return BASIC;
  if (type === 'apikey') {
    const headerName = asStr(scheme.name) || 'X-API-Key';
    if (scheme.in === 'header') return { auth: { type: 'api-key', headerName, headerValue: '{{apiKey}}' }, vars: ['apiKey'] };
    if (scheme.in === 'query') {
      return { auth: { type: 'api-key', headerName, headerValue: '{{apiKey}}', apiKeyIn: 'query' }, vars: ['apiKey'] };
    }
    return `API keys sent in a ${asStr(scheme.in) ?? 'cookie'} ("${name}") are not supported.`;
  }
  if (type === 'oauth2' || type === 'openidconnect') {
    return {
      ...BEARER,
      fallbackWarning: `OAuth 2 flows ("${name}") are not supported. Get a token yourself and set the bearerToken variable.`,
    };
  }
  return `The "${name}" security scheme (${asStr(scheme.type) ?? 'unknown type'}) is not supported.`;
}

function authFor(ctx: Ctx, op: Json): AuthConfig {
  const requirements = Array.isArray(op.security) ? op.security : asArr(ctx.doc.security);
  const schemes = asObj(ctx.v2 ? ctx.doc.securityDefinitions : asObj(ctx.doc.components)?.securitySchemes) ?? {};
  let fallback: AuthChoice | undefined;
  const problems: string[] = [];
  for (const requirement of requirements) {
    for (const name of Object.keys(asObj(requirement) ?? {})) {
      const scheme = asObj(resolve(ctx, schemes[name]));
      if (!scheme) {
        problems.push(`The security scheme "${name}" is not defined.`);
        continue;
      }
      const choice = mapScheme(name, scheme);
      if (typeof choice === 'string') problems.push(choice);
      else if (choice.fallbackWarning) fallback ??= choice;
      else return useChoice(ctx, choice);
    }
  }
  if (fallback) {
    ctx.warnings.add(fallback.fallbackWarning ?? '');
    return useChoice(ctx, fallback);
  }
  for (const p of problems) ctx.warnings.add(p);
  return { type: 'none' };
}

function useChoice(ctx: Ctx, choice: AuthChoice): AuthConfig {
  for (const v of choice.vars) addVariable(ctx, v, '');
  return { ...choice.auth };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function mergedParameters(ctx: Ctx, pathItem: Json, op: Json): Json[] {
  const byKey = new Map<string, Json>();
  for (const raw of [...asArr(pathItem.parameters), ...asArr(op.parameters)]) {
    const p = asObj(resolve(ctx, raw));
    const name = asStr(p?.name);
    const loc = asStr(p?.in);
    if (p && name && loc) byKey.set(`${loc}:${name}`, p);
  }
  return [...byKey.values()];
}

/** Query text as the URL field would show it: `&` and `#` escaped, `=` too in keys. */
function querySegment(p: KeyValuePair): string {
  const key = p.key.replace(/&/g, '%26').replace(/#/g, '%23').replace(/=/g, '%3D');
  const value = p.value.replace(/&/g, '%26').replace(/#/g, '%23');
  return p.value === '' ? key : `${key}=${value}`;
}

const BINARY_MEDIA = /^(application\/(octet-stream|pdf|zip|gzip)|image\/|audio\/|video\/)/;

function applyContent(ctx: Ctx, req: ApiRequest, content: Json): void {
  const types = Object.keys(content);
  const pick =
    types.find(t => mediaTypeOf(t) === 'application/json') ??
    types.find(t => isJsonMediaType(mediaTypeOf(t))) ??
    types.find(t => mediaTypeOf(t) === 'application/x-www-form-urlencoded') ??
    types.find(t => mediaTypeOf(t) === 'multipart/form-data') ??
    types[0];
  if (pick === undefined) return;
  const media = asObj(content[pick]) ?? {};
  const mt = mediaTypeOf(pick);
  const example = mediaExample(ctx, media);

  if (isJsonMediaType(mt) || mt === '*/*') {
    req.bodyType = 'json';
    let value = example !== undefined ? example : sample(ctx, media.schema, 0, new Set());
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        // a plain string example stays a JSON string
      }
    }
    req.body = value === undefined ? '' : JSON.stringify(value, null, 2);
    if (mt !== 'application/json' && mt !== '*/*') req.headers.push({ key: 'Content-Type', value: pick, enabled: true });
    return;
  }

  if (mt === 'application/x-www-form-urlencoded' || mt === 'multipart/form-data') {
    const exampleObj = asObj(example);
    const fields = schemaProperties(ctx, media.schema).filter(([, prop]) => asObj(resolve(ctx, prop))?.readOnly !== true);
    if (mt === 'application/x-www-form-urlencoded') {
      req.bodyType = 'form';
      req.formFields = fields.map(([key, prop]) => ({
        key,
        value: toText(exampleObj?.[key] ?? sample(ctx, prop, 0, new Set())),
        enabled: true,
      }));
    } else {
      req.bodyType = 'multipart';
      req.multipartFields = fields.map(([key, prop]): MultipartField =>
        isBinarySchema(ctx, prop)
          ? { key, value: '', enabled: true, kind: 'file' }
          : { key, value: toText(exampleObj?.[key] ?? sample(ctx, prop, 0, new Set())), enabled: true, kind: 'text' },
      );
    }
    return;
  }

  if (BINARY_MEDIA.test(mt)) {
    req.bodyType = 'binary';
    return;
  }
  req.bodyType = 'text';
  req.textContentType = pick;
  const text = example ?? asObj(resolve(ctx, media.schema))?.example;
  req.body = typeof text === 'string' ? text : '';
}

function applySwagger2Body(ctx: Ctx, req: ApiRequest, op: Json, bodyParam: Json | undefined, formParams: Json[]): void {
  const opConsumes = asArr(op.consumes).filter((c): c is string => typeof c === 'string');
  const consumes = opConsumes.length > 0 ? opConsumes : asArr(ctx.doc.consumes).filter((c): c is string => typeof c === 'string');

  if (bodyParam) {
    const type = consumes.find(c => isJsonMediaType(mediaTypeOf(c))) ?? consumes[0] ?? 'application/json';
    const media: Json = { schema: bodyParam.schema };
    if (bodyParam['x-example'] !== undefined) media.example = bodyParam['x-example'];
    applyContent(ctx, req, { [type]: media });
    return;
  }
  if (formParams.length === 0) return;
  const multipart = consumes.some(c => mediaTypeOf(c) === 'multipart/form-data') || formParams.some(p => p.type === 'file');
  if (multipart) {
    req.bodyType = 'multipart';
    req.multipartFields = formParams.map((p): MultipartField => {
      const key = asStr(p.name) ?? '';
      return p.type === 'file'
        ? { key, value: '', enabled: true, kind: 'file' }
        : { key, value: toText(paramExample(ctx, p)), enabled: true, kind: 'text' };
    });
  } else {
    req.bodyType = 'form';
    req.formFields = formParams.map(p => ({ key: asStr(p.name) ?? '', value: toText(paramExample(ctx, p)), enabled: true }));
  }
}

function buildRequest(ctx: Ctx, path: string, method: HttpMethod, pathItem: Json, op: Json, base: string): ApiRequest {
  const name = asStr(op.summary)?.trim() || asStr(op.operationId)?.trim() || `${method} ${path}`;
  const req = newRequest(name);
  req.method = method;

  const query: KeyValuePair[] = [];
  let bodyParam: Json | undefined;
  const formParams: Json[] = [];
  const where = `${method} ${path}`;

  for (const p of mergedParameters(ctx, pathItem, op)) {
    const pname = asStr(p.name) ?? '';
    const value = toText(paramExample(ctx, p));
    switch (p.in) {
      case 'path':
        addVariable(ctx, varName(pname), value);
        break;
      case 'query':
        query.push({ key: pname, value, enabled: p.required === true });
        break;
      case 'header':
        // OpenAPI 3 says these header parameters are ignored; the body and auth provide them.
        if (!ctx.v2 && ['accept', 'content-type', 'authorization'].includes(pname.toLowerCase())) break;
        req.headers.push({ key: pname, value, enabled: p.required === true });
        break;
      case 'cookie':
        ctx.warnings.add(`Cookie parameters are not imported ("${pname}" in ${where}).`);
        break;
      case 'body':
        bodyParam = p;
        break;
      case 'formData':
        formParams.push(p);
        break;
    }
  }

  // Path templates the parameters forgot to declare still need a variable.
  const urlPath = path.replace(/\{([^}]+)\}/g, (_m, pname: string) => {
    addVariable(ctx, varName(pname), '');
    return `{{${varName(pname)}}}`;
  });

  const opServer = ctx.v2 ? undefined : serverUrl(asArr(op.servers)[0]) ?? serverUrl(asArr(pathItem.servers)[0]);
  let url = `${opServer ?? base}${urlPath}`;
  const enabled = query.filter(q => q.enabled);
  if (enabled.length > 0) url += `?${enabled.map(querySegment).join('&')}`;
  req.url = url;
  req.params = query;

  if (ctx.v2) {
    applySwagger2Body(ctx, req, op, bodyParam, formParams);
  } else {
    const content = asObj(asObj(resolve(ctx, op.requestBody))?.content);
    if (content) applyContent(ctx, req, content);
  }
  if (op.callbacks !== undefined) ctx.warnings.add('Callbacks are not imported.');

  req.auth = authFor(ctx, op);
  return req;
}

// ---------------------------------------------------------------------------
// importOpenApi
// ---------------------------------------------------------------------------

/**
 * Import an OpenAPI 3.x or Swagger 2.0 JSON document. Throws an Error with a user-facing
 * message for YAML, invalid JSON, or JSON that is not an OpenAPI/Swagger document.
 *
 * `variables` holds `baseUrl`, one entry per path parameter, and the credentials the
 * auth settings reference (`bearerToken`, `username`/`password`, `apiKey`).
 */
export function importOpenApi(input: string | object): ImportResult<{ collection: Collection; variables: EnvVariable[] }> {
  const doc = parseInput(input);
  const openapi = doc.openapi !== undefined ? String(doc.openapi) : undefined;
  const swagger = doc.swagger !== undefined ? String(doc.swagger) : undefined;
  if (openapi === undefined && swagger === undefined) {
    throw new Error('This is not an OpenAPI 3 or Swagger 2 document (it has no "openapi" or "swagger" field).');
  }
  const ctx: Ctx = { doc, v2: openapi === undefined, warnings: new Set(), variables: new Map() };
  if (ctx.v2 && !swagger?.startsWith('2')) ctx.warnings.add(`Swagger version ${swagger} is not recognised; read as Swagger 2.0.`);
  if (!ctx.v2 && !openapi?.startsWith('3')) ctx.warnings.add(`OpenAPI version ${openapi} is not recognised; read as OpenAPI 3.`);

  const info = asObj(doc.info);
  const collection = newCollection(asStr(info?.title)?.trim() || 'Imported API');
  collection.description = asStr(info?.description) ?? '';

  const base = baseUrl(ctx);
  ctx.variables.set('baseUrl', base);

  const folders = new Map<string, CollectionFolder>();
  const paths = asObj(doc.paths);
  if (!paths || Object.keys(paths).length === 0) ctx.warnings.add('The document has no paths, so there are no requests to import.');

  for (const [path, rawItem] of Object.entries(paths ?? {})) {
    const pathItem = asObj(resolve(ctx, rawItem));
    if (!pathItem) continue;
    for (const m of METHODS) {
      const op = asObj(pathItem[m]);
      if (!op) continue;
      const method = m.toUpperCase();
      if (m === 'trace') {
        ctx.warnings.add(`TRACE operations are not supported; skipped TRACE ${path}.`);
        continue;
      }
      try {
        const req = buildRequest(ctx, path, method as HttpMethod, pathItem, op, '{{baseUrl}}');
        const tag = asStr(asArr(op.tags)[0])?.trim();
        if (!tag) {
          collection.requests.push(req);
        } else {
          let folder = folders.get(tag);
          if (!folder) {
            folder = { id: generateId(), name: tag, requests: [] };
            folders.set(tag, folder);
          }
          folder.requests.push(req);
        }
      } catch (e) {
        ctx.warnings.add(`Skipped ${method} ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (isObj(doc.webhooks) && Object.keys(doc.webhooks).length > 0) ctx.warnings.add('Webhooks are not imported.');

  // Folders follow the spec's top-level tag order, then the order tags first appear.
  const declared = asArr(doc.tags).map(t => asStr(asObj(t)?.name));
  const rank = (name: string) => {
    const i = declared.indexOf(name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  collection.folders = [...folders.values()]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f.name) - rank(b.f.name) || a.i - b.i)
    .map(({ f }) => f);

  const variables: EnvVariable[] = [...ctx.variables].map(([key, value]) => ({ key, value, enabled: true }));
  return { value: { collection, variables }, warnings: [...ctx.warnings].filter(Boolean) };
}
