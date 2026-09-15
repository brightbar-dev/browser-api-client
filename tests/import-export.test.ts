import { describe, it, expect } from 'vitest';
import {
  importPostmanCollection,
  importPostmanCollectionDetailed,
  importPostmanEnvironment,
  exportToPostman,
  exportEnvironmentToPostman,
  exportNative,
  importNative,
  detectFormat,
} from '../utils/import-export';
import { newCollection, addRequest } from '../utils/collections';
import type { Collection } from '../utils/collections';
import { newRequest } from '../utils/request';
import type { ApiRequest } from '../utils/request';
import { newEnvironment } from '../utils/environment';

describe('importPostmanCollection', () => {
  const postmanJson = JSON.stringify({
    info: {
      name: 'Test API',
      description: 'A test collection',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Get Users',
        request: {
          method: 'GET',
          url: { raw: 'https://api.example.com/users?limit=10', query: [{ key: 'limit', value: '10' }] },
          header: [{ key: 'Accept', value: 'application/json' }],
        },
      },
      {
        name: 'Create User',
        request: {
          method: 'POST',
          url: 'https://api.example.com/users',
          body: { mode: 'raw', raw: '{"name":"test"}', options: { raw: { language: 'json' } } },
          auth: { type: 'bearer', bearer: [{ key: 'token', value: 'abc123' }] },
        },
      },
    ],
  });

  it('imports collection name and description', () => {
    const c = importPostmanCollection(postmanJson);
    expect(c.name).toBe('Test API');
    expect(c.description).toBe('A test collection');
  });

  it('imports requests', () => {
    const c = importPostmanCollection(postmanJson);
    expect(c.requests).toHaveLength(2);
  });

  it('parses GET request with params', () => {
    const c = importPostmanCollection(postmanJson);
    const r = c.requests[0]!;
    expect(r.name).toBe('Get Users');
    expect(r.method).toBe('GET');
    expect(r.params).toHaveLength(1);
    expect(r.params[0]!.key).toBe('limit');
  });

  it('keeps the query string in the URL (params mirror it)', () => {
    const r = importPostmanCollection(postmanJson).requests[0]!;
    expect(r.url).toBe('https://api.example.com/users?limit=10');
    expect(r.params).toEqual([{ key: 'limit', value: '10', enabled: true }]);
  });

  it('parses POST with JSON body and auth', () => {
    const c = importPostmanCollection(postmanJson);
    const r = c.requests[1]!;
    expect(r.method).toBe('POST');
    expect(r.body).toBe('{"name":"test"}');
    expect(r.bodyType).toBe('json');
    expect(r.auth.type).toBe('bearer');
    expect(r.auth.token).toBe('abc123');
  });

  it('parses basic auth', () => {
    const json = JSON.stringify({
      info: { name: 'Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: 'With Basic',
        request: {
          method: 'GET',
          url: 'https://api.example.com',
          auth: { type: 'basic', basic: [{ key: 'username', value: 'user' }, { key: 'password', value: 'pass' }] },
        },
      }],
    });
    const c = importPostmanCollection(json);
    expect(c.requests[0]!.auth.type).toBe('basic');
    expect(c.requests[0]!.auth.username).toBe('user');
  });
});

describe('importPostmanCollectionDetailed', () => {
  const fixture = {
    info: {
      name: 'Everything',
      description: { content: 'Every body mode', type: 'text/markdown' },
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{rootToken}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: 'https://api.example.com' },
      { key: 'rootToken', value: 'secret-value' },
    ],
    item: [
      {
        name: 'Users',
        auth: { type: 'apikey', apikey: [{ key: 'key', value: 'api_key' }, { key: 'value', value: '{{key}}' }, { key: 'in', value: 'query' }] },
        item: [
          {
            name: 'List users',
            request: {
              method: 'GET',
              url: {
                raw: '{{baseUrl}}/users?page=1',
                host: ['{{baseUrl}}'],
                path: ['users'],
                query: [
                  { key: 'page', value: '1' },
                  { key: 'debug', value: 'true', disabled: true },
                ],
              },
            },
          },
          {
            name: 'Admin',
            item: [
              {
                name: 'Audit',
                item: [
                  {
                    name: 'Export log',
                    request: { method: 'get', url: '{{baseUrl}}/audit/export', auth: { type: 'noauth' } },
                  },
                ],
              },
              {
                name: 'Ban user',
                event: [{ listen: 'prerequest', script: { exec: ['pm.environment.set("x", 1)'] } }],
                request: {
                  method: 'POST',
                  url: '{{baseUrl}}/users/ban',
                  body: {
                    mode: 'urlencoded',
                    urlencoded: [
                      { key: 'id', value: '42' },
                      { key: 'reason', value: 'spam', disabled: true },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
      {
        name: 'Uploads',
        item: [
          {
            name: 'Upload avatar',
            request: {
              method: 'POST',
              url: '{{baseUrl}}/avatar',
              body: {
                mode: 'formdata',
                formdata: [
                  { key: 'caption', value: 'me', type: 'text' },
                  { key: 'photo', type: 'file', src: '/Users/ken/Pictures/me.png' },
                ],
              },
            },
          },
          {
            name: 'Upload raw',
            request: { method: 'PUT', url: '{{baseUrl}}/blob', body: { mode: 'file', file: { src: 'data.bin' } } },
          },
        ],
      },
      {
        name: 'GraphQL',
        request: {
          method: 'POST',
          url: '{{baseUrl}}/graphql',
          body: { mode: 'graphql', graphql: { query: 'query ($id: ID!) { user(id: $id) { name } }', variables: '{"id": "1"}' } },
        },
      },
      {
        name: 'XML',
        request: {
          method: 'POST',
          url: 'https://soap.example.com/ws',
          header: [{ key: 'SOAPAction', value: 'Get' }],
          body: { mode: 'raw', raw: '<Envelope/>', options: { raw: { language: 'xml' } } },
          auth: { type: 'digest', digest: [] },
        },
      },
      {
        name: 'HTML',
        request: { method: 'POST', url: 'https://e.com/h', body: { mode: 'raw', raw: '<p>hi</p>', options: { raw: { language: 'html' } } } },
      },
      {
        name: 'Plain string request',
        request: 'https://e.com/ping?x=1',
      },
    ],
  };

  const { value: c, warnings } = importPostmanCollectionDetailed(JSON.stringify(fixture));
  const folder = (name: string) => c.folders?.find(f => f.name === name);
  const req = (folderName: string | null, name: string): ApiRequest => {
    const list = folderName === null ? c.requests : folder(folderName)?.requests ?? [];
    const r = list.find(x => x.name === name);
    if (!r) throw new Error(`missing ${name}`);
    return r;
  };

  it('reads a description object', () => {
    expect(c.description).toBe('Every body mode');
  });

  it('turns top-level folders into folders and flattens deeper ones with a name prefix', () => {
    expect(c.folders?.map(f => f.name)).toEqual(['Users', 'Uploads']);
    expect(folder('Users')?.requests.map(r => r.name)).toEqual(['List users', 'Admin / Audit / Export log', 'Admin / Ban user']);
    expect(c.requests.map(r => r.name)).toEqual(['GraphQL', 'XML', 'HTML', 'Plain string request']);
  });

  it('keeps the query in the URL and disabled query rows in params', () => {
    const r = req('Users', 'List users');
    expect(r.url).toBe('{{baseUrl}}/users?page=1');
    expect(r.params).toEqual([
      { key: 'page', value: '1', enabled: true },
      { key: 'debug', value: 'true', enabled: false },
    ]);
    const plain = req(null, 'Plain string request');
    expect(plain.url).toBe('https://e.com/ping?x=1');
    expect(plain.params).toEqual([{ key: 'x', value: '1', enabled: true }]);
  });

  it('inherits auth from the folder and collection, and apikey in: query sets apiKeyIn', () => {
    expect(req('Users', 'List users').auth).toEqual({ type: 'api-key', headerName: 'api_key', headerValue: '{{key}}', apiKeyIn: 'query' });
    expect(req('Users', 'Admin / Ban user').auth.type).toBe('api-key');
    expect(req('Users', 'Admin / Audit / Export log').auth).toEqual({ type: 'none' });
    expect(req('Uploads', 'Upload avatar').auth).toEqual({ type: 'bearer', token: '{{rootToken}}' });
    expect(req(null, 'GraphQL').auth).toEqual({ type: 'bearer', token: '{{rootToken}}' });
  });

  it('lower-case methods are normalised', () => {
    expect(req('Users', 'Admin / Audit / Export log').method).toBe('GET');
  });

  it('urlencoded becomes form with formFields', () => {
    const r = req('Users', 'Admin / Ban user');
    expect(r.bodyType).toBe('form');
    expect(r.formFields).toEqual([
      { key: 'id', value: '42', enabled: true },
      { key: 'reason', value: 'spam', enabled: false },
    ]);
  });

  it('formdata becomes multipart with file fields that have no file, and a warning', () => {
    const r = req('Uploads', 'Upload avatar');
    expect(r.bodyType).toBe('multipart');
    expect(r.multipartFields).toEqual([
      { key: 'caption', value: 'me', enabled: true, kind: 'text' },
      { key: 'photo', value: 'me.png', enabled: true, kind: 'file' },
    ]);
    expect(warnings.some(w => w.includes('"photo"') && w.includes('Upload avatar'))).toBe(true);
  });

  it('file bodies become binary without a file, with a warning', () => {
    const r = req('Uploads', 'Upload raw');
    expect(r.bodyType).toBe('binary');
    expect(r.binaryFile).toBeUndefined();
    expect(warnings.some(w => w.includes('Upload raw'))).toBe(true);
  });

  it('graphql bodies keep query and variables', () => {
    const r = req(null, 'GraphQL');
    expect(r.bodyType).toBe('graphql');
    expect(r.body).toBe('query ($id: ID!) { user(id: $id) { name } }');
    expect(r.graphqlVariables).toBe('{"id": "1"}');
  });

  it('raw xml/html become text with a matching textContentType', () => {
    expect(req(null, 'XML')).toMatchObject({ bodyType: 'text', textContentType: 'application/xml', body: '<Envelope/>' });
    expect(req(null, 'HTML')).toMatchObject({ bodyType: 'text', textContentType: 'text/html' });
  });

  it('unsupported auth warns and imports as none', () => {
    expect(req(null, 'XML').auth).toEqual({ type: 'none' });
    expect(warnings.some(w => w.includes('digest'))).toBe(true);
  });

  it('warns about collection variables by name only, and about scripts', () => {
    const v = warnings.find(w => w.includes('variables'));
    expect(v).toContain('baseUrl, rootToken');
    expect(v).not.toContain('secret-value');
    expect(warnings).toContain('Pre-request and test scripts are not imported.');
  });

  it('reads v2.0 object-shaped auth and graphql variables objects', () => {
    const json = JSON.stringify({
      info: { name: 'v2.0' },
      item: [
        {
          name: 'r',
          request: {
            method: 'POST',
            url: 'https://e.com',
            auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
            body: { mode: 'graphql', graphql: { query: '{ a }', variables: { x: 1 } } },
          },
        },
      ],
    });
    const r = importPostmanCollectionDetailed(json).value.requests[0]!;
    expect(r.auth).toEqual({ type: 'basic', username: 'u', password: 'p' });
    expect(JSON.parse(r.graphqlVariables ?? '')).toEqual({ x: 1 });
  });

  it('raw without a language uses the Content-Type header', () => {
    const json = JSON.stringify({
      info: { name: 'x' },
      item: [
        { name: 'json', request: { method: 'POST', url: 'https://e.com', header: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', raw: '{}' } } },
        { name: 'csv', request: { method: 'POST', url: 'https://e.com', header: [{ key: 'Content-Type', value: 'text/csv' }], body: { mode: 'raw', raw: 'a,b' } } },
      ],
    });
    const [a, b] = importPostmanCollectionDetailed(json).value.requests;
    expect(a?.bodyType).toBe('json');
    expect(b?.bodyType).toBe('text');
    expect(b?.textContentType).toBe('text/csv');
  });

  it('appends enabled query rows when raw has no query, and builds a URL from parts', () => {
    const json = JSON.stringify({
      info: { name: 'x' },
      item: [
        { name: 'q', request: { method: 'GET', url: { raw: 'https://e.com/s', query: [{ key: 'a', value: '1' }, { key: 'flag', value: null }] } } },
        { name: 'parts', request: { method: 'GET', url: { protocol: 'https', host: ['api', 'e', 'com'], port: '8443', path: ['v1', 'x'] } } },
      ],
    });
    const [q, parts] = importPostmanCollectionDetailed(json).value.requests;
    expect(q?.url).toBe('https://e.com/s?a=1&flag');
    expect(parts?.url).toBe('https://api.e.com:8443/v1/x');
  });

  it('throws a friendly error on invalid JSON and tolerates junk', () => {
    expect(() => importPostmanCollectionDetailed('{nope')).toThrow(/not valid JSON/);
    const { value } = importPostmanCollectionDetailed(JSON.stringify({ item: [null, 5, { name: 'no request' }] }));
    expect(value.name).toBe('Imported Collection');
    expect(value.requests).toEqual([]);
  });
});

describe('importPostmanEnvironment', () => {
  const envJson = JSON.stringify({
    name: 'Production',
    values: [
      { key: 'base_url', value: 'https://api.prod.com', enabled: true },
      { key: 'api_key', value: 'secret', enabled: true },
      { key: 'debug', value: 'false', enabled: false },
    ],
  });

  it('imports environment name', () => {
    const env = importPostmanEnvironment(envJson);
    expect(env.name).toBe('Production');
  });

  it('imports variables with enabled state', () => {
    const env = importPostmanEnvironment(envJson);
    expect(env.variables).toHaveLength(3);
    expect(env.variables[2]!.enabled).toBe(false);
  });
});

describe('exportToPostman', () => {
  it('exports as valid Postman JSON', () => {
    const r = { ...newRequest('Test Request'), method: 'POST' as const, url: 'https://api.example.com', body: '{"a":1}', bodyType: 'json' as const };
    const c = addRequest(newCollection('My Collection'), r);
    const json = exportToPostman(c);
    const parsed = JSON.parse(json);

    expect(parsed.info.name).toBe('My Collection');
    expect(parsed.info.schema).toContain('getpostman.com');
    expect(parsed.item).toHaveLength(1);
    expect(parsed.item[0].request.method).toBe('POST');
    expect(parsed.item[0].request.body.raw).toBe('{"a":1}');
  });

  it('roundtrips: export then import preserves data', () => {
    const r = { ...newRequest('Roundtrip'), method: 'GET' as const, url: 'https://test.com/api' };
    const original = addRequest(newCollection('Round Trip'), r);
    const json = exportToPostman(original);
    const imported = importPostmanCollection(json);

    expect(imported.name).toBe('Round Trip');
    expect(imported.requests).toHaveLength(1);
    expect(imported.requests[0]!.name).toBe('Roundtrip');
    expect(imported.requests[0]!.method).toBe('GET');
  });

  it('does not append the query twice and exports URL parts and disabled params', () => {
    const r: ApiRequest = {
      ...newRequest('Q'),
      url: 'https://api.example.com:8443/v1/items?page=2#top',
      params: [
        { key: 'page', value: '2', enabled: true },
        { key: 'debug', value: '1', enabled: false },
      ],
    };
    const url = JSON.parse(exportToPostman(addRequest(newCollection('C'), r))).item[0].request.url;
    expect(url).toEqual({
      raw: 'https://api.example.com:8443/v1/items?page=2#top',
      protocol: 'https',
      host: ['api', 'example', 'com'],
      port: '8443',
      path: ['v1', 'items'],
      hash: 'top',
      query: [
        { key: 'page', value: '2', disabled: false },
        { key: 'debug', value: '1', disabled: true },
      ],
    });
  });

  it('exports folders, every body mode and apiKeyIn, and roundtrips them', () => {
    const base = newRequest('base');
    const form: ApiRequest = { ...base, id: 'f', name: 'Form', method: 'POST', url: '{{baseUrl}}/form', bodyType: 'form', formFields: [{ key: 'a', value: '1', enabled: true }, { key: 'b', value: '2', enabled: false }] };
    const multipart: ApiRequest = {
      ...base, id: 'm', name: 'Multipart', method: 'POST', url: '{{baseUrl}}/up', bodyType: 'multipart',
      multipartFields: [
        { key: 'caption', value: 'hi', enabled: true, kind: 'text' },
        { key: 'photo', value: '', enabled: true, kind: 'file', file: { id: 'idb1', name: 'me.png', size: 10, type: 'image/png' } },
      ],
      auth: { type: 'api-key', headerName: 'key', headerValue: '{{k}}', apiKeyIn: 'query' },
    };
    const graphql: ApiRequest = { ...base, id: 'g', name: 'GQL', method: 'POST', url: '{{baseUrl}}/graphql', bodyType: 'graphql', body: '{ me { id } }', graphqlVariables: '{"a":1}' };
    const binary: ApiRequest = { ...base, id: 'b', name: 'Bin', method: 'PUT', url: '{{baseUrl}}/b', bodyType: 'binary', binaryFile: { id: 'idb2', name: 'data.bin', size: 3, type: '' } };
    const xml: ApiRequest = { ...base, id: 'x', name: 'XML', method: 'POST', url: '{{baseUrl}}/x', bodyType: 'text', body: '<a/>', textContentType: 'application/xml' };
    const collection: Collection = {
      ...newCollection('Modes'),
      requests: [xml],
      folders: [{ id: 'fo', name: 'Bodies', requests: [form, multipart, graphql, binary] }],
    };

    const parsed = JSON.parse(exportToPostman(collection));
    expect(parsed.item.map((i: { name: string }) => i.name)).toEqual(['Bodies', 'XML']);
    const [pForm, pMultipart, pGraphql, pBinary] = parsed.item[0].item;
    expect(pForm.request.body).toEqual({ mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1', disabled: false }, { key: 'b', value: '2', disabled: true }] });
    expect(pMultipart.request.body.formdata).toEqual([
      { key: 'caption', value: 'hi', type: 'text', disabled: false },
      { key: 'photo', type: 'file', src: 'me.png', disabled: false },
    ]);
    expect(pMultipart.request.auth.apikey).toContainEqual({ key: 'in', value: 'query' });
    expect(pGraphql.request.body).toEqual({ mode: 'graphql', graphql: { query: '{ me { id } }', variables: '{"a":1}' } });
    expect(pBinary.request.body).toEqual({ mode: 'file', file: { src: 'data.bin' } });
    expect(parsed.item[1].request.body.options.raw.language).toBe('xml');

    const back = importPostmanCollectionDetailed(exportToPostman(collection)).value;
    expect(back.folders?.[0]?.requests.map(r => r.bodyType)).toEqual(['form', 'multipart', 'graphql', 'binary']);
    expect(back.folders?.[0]?.requests[1]?.auth).toEqual({ type: 'api-key', headerName: 'key', headerValue: '{{k}}', apiKeyIn: 'query' });
    expect(back.folders?.[0]?.requests[2]?.graphqlVariables).toBe('{"a":1}');
    expect(back.requests[0]).toMatchObject({ bodyType: 'text', textContentType: 'application/xml', body: '<a/>' });
  });
});

describe('exportEnvironmentToPostman', () => {
  it('exports environment as Postman format', () => {
    const env = { ...newEnvironment('Staging'), variables: [{ key: 'host', value: 'staging.api.com', enabled: true }] };
    const json = exportEnvironmentToPostman(env);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('Staging');
    expect(parsed.values).toHaveLength(1);
    expect(parsed.values[0].key).toBe('host');
  });
});

describe('native format', () => {
  it('exports and imports native format', () => {
    const c = addRequest(newCollection('Native Test'), newRequest('My Request'));
    const env = { ...newEnvironment('Dev'), variables: [{ key: 'url', value: 'http://localhost', enabled: true }] };

    const json = exportNative([c], [env]);
    const result = importNative(json);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.collections).toHaveLength(1);
    expect(result!.environments).toHaveLength(1);
    expect(result!.collections[0]!.name).toBe('Native Test');
  });

  it('returns null for invalid native format', () => {
    expect(importNative('{"version": 2}')).toBeNull();
    expect(importNative('not json')).toBeNull();
    expect(importNative('{"version": 1}')).toBeNull();
  });
});

describe('detectFormat', () => {
  it('detects Postman collection', () => {
    const json = JSON.stringify({
      info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [],
    });
    expect(detectFormat(json)).toBe('postman-collection');
  });

  it('detects Postman environment', () => {
    const json = JSON.stringify({ name: 'Test', values: [{ key: 'a', value: 'b', enabled: true }] });
    expect(detectFormat(json)).toBe('postman-environment');
  });

  it('detects native format', () => {
    const json = JSON.stringify({ version: 1, collections: [], environments: [] });
    expect(detectFormat(json)).toBe('native');
  });

  it('returns unknown for unrecognized', () => {
    expect(detectFormat('{"foo": "bar"}')).toBe('unknown');
    expect(detectFormat('not json')).toBe('unknown');
  });
});
