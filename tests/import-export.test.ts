import { describe, it, expect } from 'vitest';
import {
  importPostmanCollection,
  importPostmanEnvironment,
  exportToPostman,
  exportEnvironmentToPostman,
  exportNative,
  importNative,
  detectFormat,
} from '../utils/import-export';
import { newCollection, addRequest } from '../utils/collections';
import { newRequest } from '../utils/request';
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
    const r = c.requests[0];
    expect(r.name).toBe('Get Users');
    expect(r.method).toBe('GET');
    expect(r.params).toHaveLength(1);
    expect(r.params[0].key).toBe('limit');
  });

  it('parses POST with JSON body and auth', () => {
    const c = importPostmanCollection(postmanJson);
    const r = c.requests[1];
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
    expect(c.requests[0].auth.type).toBe('basic');
    expect(c.requests[0].auth.username).toBe('user');
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
    expect(env.variables[2].enabled).toBe(false);
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
    expect(imported.requests[0].name).toBe('Roundtrip');
    expect(imported.requests[0].method).toBe('GET');
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
    expect(result!.collections[0].name).toBe('Native Test');
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
