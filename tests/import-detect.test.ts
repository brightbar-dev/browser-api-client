import { describe, it, expect } from 'vitest';
import { detectImportKind, runImport } from '../utils/import-detect';
import { countRequests } from '../utils/collections';

const j = (v: unknown) => JSON.stringify(v, null, 2);

const OPENAPI = j({
  openapi: '3.0.0',
  info: { title: 'Petstore' },
  servers: [{ url: 'https://petstore.test/v1' }],
  tags: [{ name: 'pets' }, { name: 'store' }],
  paths: {
    '/pets': {
      get: { tags: ['pets'], summary: 'List pets' },
      post: { tags: ['pets'], summary: 'Create pet' },
    },
    '/pets/{petId}': {
      get: { tags: ['pets'], summary: 'Get pet', parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }] },
    },
    '/store/inventory': { get: { tags: ['store'], summary: 'Inventory' } },
    '/health': { get: { summary: 'Health' } },
  },
});

const POSTMAN_COLLECTION = j({
  info: { name: 'Demo', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    { name: 'Users', item: [{ name: 'List', request: { method: 'GET', url: 'https://api.test/users' } }] },
    { name: 'Ping', request: { method: 'GET', url: 'https://api.test/ping' } },
  ],
  variable: [{ key: 'token', value: 'x' }],
});

const POSTMAN_ENVIRONMENT = j({
  id: 'abc',
  name: 'Prod',
  values: [
    { key: 'baseUrl', value: 'https://prod.test', enabled: true },
    { key: 'token', value: 's3cr3t', type: 'secret', enabled: true },
    { key: 'old', value: 'x', enabled: false },
    null,
  ],
  _postman_variable_scope: 'environment',
});

const HAR = j({
  log: {
    version: '1.2',
    entries: [
      { request: { method: 'GET', url: 'https://api.test/a', headers: [] } },
      { request: { method: 'POST', url: 'https://api.test/b', headers: [], postData: { mimeType: 'application/json', text: '{"x":1}' } } },
      { request: { method: 'GET', url: 'data:text/plain,hi', headers: [] } },
    ],
  },
});

const BACKUP = j({ format: 'browser-api-client-backup', version: 2, exportedAt: '2026-09-14T00:00:00Z', data: { collections: [] } });
const NATIVE_V1 = j({ version: 1, collections: [], environments: [], exportedAt: '2026-01-01T00:00:00Z' });

describe('detectImportKind', () => {
  it.each([
    'curl https://api.example.com/users',
    "  curl -X POST 'https://api.example.com/items' -d '{\"a\":1}'",
    '$ curl https://api.example.com',
    'CURL https://api.example.com',
    'curl.exe "https://api.example.com"',
    "curl \\\n  'https://api.example.com/users' \\\n  -H 'Accept: application/json'",
    'curl localhost:3000/health',
    'sudo curl https://api.example.com/x',
    'PS C:\\> curl.exe -s https://api.example.com/x',
    '\uFEFFcurl https://api.example.com',
  ])('detects curl: %j', text => {
    expect(detectImportKind(text)).toBe('curl');
  });

  it.each([
    'curlew https://birds.test',
    'libcurl https://curl.se',
    'see https://curl.se for curl',
    'hello world',
    'wget https://api.example.com',
    'GET https://api.example.com',
  ])('does not detect curl: %j', text => {
    expect(detectImportKind(text)).toBe('unknown');
  });

  it('detects OpenAPI 3 and Swagger 2 JSON', () => {
    expect(detectImportKind(OPENAPI)).toBe('openapi');
    expect(detectImportKind(j({ swagger: '2.0', info: { title: 'Old' }, paths: {} }))).toBe('openapi');
    expect(detectImportKind('\uFEFF' + OPENAPI)).toBe('openapi');
  });

  it('detects a Postman collection by schema or by info plus item', () => {
    expect(detectImportKind(POSTMAN_COLLECTION)).toBe('postman-collection');
    expect(detectImportKind(j({ info: { name: 'No schema' }, item: [] }))).toBe('postman-collection');
    expect(detectImportKind(j({ info: { schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' } }))).toBe('postman-collection');
  });

  it('detects a Postman environment by values plus name or by scope', () => {
    expect(detectImportKind(POSTMAN_ENVIRONMENT)).toBe('postman-environment');
    expect(detectImportKind(j({ name: 'Env', values: [] }))).toBe('postman-environment');
    expect(detectImportKind(j({ _postman_variable_scope: 'environment' }))).toBe('postman-environment');
    expect(detectImportKind(j({ _postman_variable_scope: 'globals', values: [] }))).toBe('unknown');
  });

  it('detects HAR', () => {
    expect(detectImportKind(HAR)).toBe('har');
    expect(detectImportKind(j({ log: { entries: [] } }))).toBe('har');
    expect(detectImportKind(j({ log: {} }))).toBe('unknown');
  });

  it('detects our backups', () => {
    expect(detectImportKind(BACKUP)).toBe('backup');
    expect(detectImportKind(NATIVE_V1)).toBe('backup');
    expect(detectImportKind(j({ version: 1, collections: [] }))).toBe('unknown');
  });

  it.each([
    '',
    '   \n ',
    '[1, 2]',
    '{"a": 1}',
    '{"openapi": {"v": 3}}',
    '{not json',
    'null',
    'openapi: 3.0.0\ninfo:\n  title: Pets',
  ])('returns unknown for %j', text => {
    expect(detectImportKind(text)).toBe('unknown');
  });
});

describe('runImport', () => {
  it('imports a curl command as one request', () => {
    const out = runImport("curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{\"name\":\"a\"}'");
    expect(out.kind).toBe('curl');
    expect(out.collections).toEqual([]);
    expect(out.environments).toEqual([]);
    expect(out.requests).toHaveLength(1);
    const r = out.requests[0]!;
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.example.com/users');
    expect(r.bodyType).toBe('json');
    expect(out.summary).toBe(`Imported request “${r.name}”.`);
    expect(r.name).toBeTruthy();
  });

  it('drops a prompt or sudo before curl', () => {
    const out = runImport('sudo curl https://api.example.com/x');
    expect(out.requests[0]!.url).toBe('https://api.example.com/x');
    expect(runImport('$ curl https://api.example.com/y').requests[0]!.url).toBe('https://api.example.com/y');
  });

  it('passes curl warnings through', () => {
    const out = runImport('curl --compressed --frobnicate https://api.example.com');
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('passes a curl parse error through', () => {
    expect(() => runImport('curl')).toThrow(Error);
  });

  it('imports OpenAPI as a collection and an environment named after it', () => {
    const out = runImport(OPENAPI);
    expect(out.kind).toBe('openapi');
    expect(out.requests).toEqual([]);
    expect(out.collections).toHaveLength(1);
    const c = out.collections[0]!;
    expect(c.name).toBe('Petstore');
    expect(c.folders!.map(f => f.name)).toEqual(['pets', 'store']);
    expect(countRequests(c)).toBe(5);
    expect(out.environments).toHaveLength(1);
    const env = out.environments[0]!;
    expect(env.name).toBe('Petstore');
    expect(env.id).toBeTruthy();
    expect(env.variables.map(v => v.key)).toContain('baseUrl');
    expect(env.variables.find(v => v.key === 'baseUrl')!.value).toBe('https://petstore.test/v1');
    expect(out.summary).toBe(
      `Imported collection “Petstore” with 2 folders and 5 requests, and environment “Petstore” with ${env.variables.length} variables.`,
    );
  });

  it('passes OpenAPI warnings through', () => {
    const out = runImport(j({ openapi: '3.0.0', info: { title: 'Hooks' }, paths: {}, webhooks: { a: {} } }));
    expect(out.warnings).toContain('Webhooks are not imported.');
    expect(out.summary).toMatch(/^Imported collection “Hooks” with 0 requests, and environment “Hooks” with 1 variable\.$/);
  });

  it('imports a Postman collection with its folders and warnings', () => {
    const out = runImport(POSTMAN_COLLECTION);
    expect(out.kind).toBe('postman-collection');
    expect(out.collections).toHaveLength(1);
    expect(out.environments).toEqual([]);
    expect(out.requests).toEqual([]);
    const c = out.collections[0]!;
    expect(c.folders!.map(f => f.name)).toEqual(['Users']);
    expect(countRequests(c)).toBe(2);
    expect(out.summary).toBe('Imported collection “Demo” with 1 folder and 2 requests.');
    expect(out.warnings.some(w => w.includes('token'))).toBe(true);
  });

  it('imports a Postman environment, marking secrets and skipping malformed rows', () => {
    const out = runImport(POSTMAN_ENVIRONMENT);
    expect(out.kind).toBe('postman-environment');
    expect(out.collections).toEqual([]);
    expect(out.requests).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(out.environments).toHaveLength(1);
    const env = out.environments[0]!;
    expect(env.name).toBe('Prod');
    expect(env.id).toBeTruthy();
    expect(env.variables).toEqual([
      { key: 'baseUrl', value: 'https://prod.test', enabled: true },
      { key: 'token', value: 's3cr3t', enabled: true, secret: true },
      { key: 'old', value: 'x', enabled: false },
    ]);
    expect(out.summary).toBe('Imported environment “Prod” with 3 variables.');
  });

  it('names an unnamed Postman environment', () => {
    const out = runImport(j({ _postman_variable_scope: 'environment', values: [{ key: 'a', value: 1 }] }));
    expect(out.environments[0]!.name).toBe('Imported Environment');
    expect(out.environments[0]!.variables).toEqual([{ key: 'a', value: '1', enabled: true }]);
    expect(out.summary).toBe('Imported environment “Imported Environment” with 1 variable.');
  });

  it('imports HAR as a collection named "HAR import"', () => {
    const out = runImport(HAR);
    expect(out.kind).toBe('har');
    expect(out.requests).toEqual([]);
    expect(out.environments).toEqual([]);
    expect(out.collections).toHaveLength(1);
    const c = out.collections[0]!;
    expect(c.name).toBe('HAR import');
    expect(c.requests.map(r => r.url)).toEqual(['https://api.test/a', 'https://api.test/b']);
    expect(c.folders).toBeUndefined();
    expect(out.summary).toBe('Imported collection “HAR import” with 2 requests.');
    expect(out.warnings.some(w => /not http or https/.test(w))).toBe(true);
  });

  it('refuses backups and points to Settings', () => {
    const message = 'This is a Browser API Client backup — import it from Settings.';
    expect(() => runImport(BACKUP)).toThrow(message);
    expect(() => runImport(NATIVE_V1)).toThrow(message);
  });

  it('explains YAML', () => {
    expect(() => runImport('openapi: 3.0.0\ninfo:\n  title: Pets\npaths: {}')).toThrow(/YAML OpenAPI document.*JSON/);
    expect(() => runImport('swagger: "2.0"\ninfo:\n  title: Pets')).toThrow(/YAML OpenAPI/);
    expect(() => runImport('---\nfoo: bar')).toThrow(/looks like YAML/);
    expect(() => runImport('# config\nname: thing\nitems:\n  - a: 1')).toThrow(/looks like YAML/);
  });

  it('explains invalid and unrecognised JSON', () => {
    expect(() => runImport('{not json')).toThrow(/^This is not valid JSON: /);
    expect(() => runImport('{"a": 1}')).toThrow(/^This JSON is not a format that can be imported\. Paste a curl command/);
    expect(() => runImport('[]')).toThrow(/not a format that can be imported/);
  });

  it('explains empty and unrecognised text', () => {
    expect(() => runImport('')).toThrow(/^Nothing to import\./);
    expect(() => runImport('  \n')).toThrow(/^Nothing to import\./);
    expect(() => runImport('hello world')).toThrow(/^This is not something that can be imported\. Paste a curl command/);
    expect(() => runImport('Host: example.com')).toThrow(/not something that can be imported/);
  });
});
