import { describe, it, expect } from 'vitest';
import { importOpenApi } from '../utils/openapi-import';
import type { ApiRequest } from '../utils/request';
import type { Collection } from '../utils/collections';

const petstore = {
  openapi: '3.0.3',
  info: { title: 'Pet Store', description: 'Pets API', version: '1.0.0' },
  servers: [
    {
      url: 'https://{env}.petstore.test/v{version}/',
      variables: { env: { default: 'api' }, version: { default: '2', enum: ['1', '2'] } },
    },
  ],
  tags: [{ name: 'store' }, { name: 'pet' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/pets': {
      get: {
        tags: ['pet'],
        summary: 'List pets',
        parameters: [
          { name: 'limit', in: 'query', required: true, schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['available', 'sold'] } },
          { $ref: '#/components/parameters/TraceId' },
          { name: 'Accept', in: 'header', schema: { type: 'string' } },
          { name: 'session', in: 'cookie', schema: { type: 'string' } },
        ],
      },
      post: {
        tags: ['pet', 'admin'],
        operationId: 'createPet',
        requestBody: { $ref: '#/components/requestBodies/PetBody' },
        security: [{ apiKeyHeader: [] }],
      },
    },
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' }, example: 'rex-42' }],
      get: { tags: ['pet'], summary: 'Get a pet', security: [{ oauth: ['read'] }, { apiKeyQuery: [] }] },
      delete: { tags: ['pet'], security: [] },
    },
    '/pets/{petId}/photo': {
      post: {
        tags: ['pet'],
        summary: 'Upload photo',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  caption: { type: 'string', example: 'Rex at the beach' },
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
      },
    },
    '/store/orders': {
      post: {
        tags: ['store'],
        summary: 'Place order',
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                properties: {
                  petId: { type: 'integer', example: 7 },
                  quantity: { type: 'integer', default: 1 },
                  shipDate: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    '/health': { get: { summary: 'Health check', security: [{ basicAuth: [] }] } },
    '/login': {
      post: {
        operationId: 'login',
        security: [{ oauth: [] }],
        requestBody: {
          content: {
            'application/json': {
              examples: { first: { value: { user: 'ken', pass: 'x' } }, second: { value: { user: 'other' } } },
              schema: { type: 'object', properties: { ignored: { type: 'string' } } },
            },
          },
        },
      },
    },
    '/users/{user-id}/notes': {
      put: {
        requestBody: {
          content: {
            'application/xml': { example: '<note/>' },
          },
        },
        callbacks: { onDone: {} },
      },
    },
  },
  components: {
    parameters: {
      TraceId: { name: 'X-Trace-Id', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
    },
    requestBodies: {
      PetBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPet' } } } },
    },
    schemas: {
      NewPet: {
        allOf: [
          { $ref: '#/components/schemas/PetBase' },
          { type: 'object', properties: { tags: { type: 'array', items: { $ref: '#/components/schemas/Tag' } } } },
        ],
      },
      PetBase: {
        type: 'object',
        required: ['name'],
        properties: {
          id: { type: 'integer', readOnly: true },
          name: { type: 'string', example: 'Rex' },
          birthday: { type: 'string', format: 'date' },
          owner: { type: 'string', format: 'email' },
          kind: { type: 'string', enum: ['dog', 'cat'] },
          category: { $ref: '#/components/schemas/Category' },
          microchip: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'integer' }] },
          weight: { type: ['number', 'null'], minimum: 1 },
          vaccinated: { type: 'boolean' },
        },
      },
      Category: {
        type: 'object',
        properties: { name: { type: 'string' }, parent: { $ref: '#/components/schemas/Category' } },
      },
      Tag: { type: 'object', properties: { label: { type: 'string', default: 'friendly' } } },
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      basicAuth: { type: 'http', scheme: 'basic' },
      apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      apiKeyQuery: { type: 'apiKey', in: 'query', name: 'api_key' },
      oauth: { type: 'oauth2', flows: { implicit: { authorizationUrl: 'https://auth.test', scopes: { read: 'read' } } } },
    },
  },
};

function find(collection: Collection, name: string): ApiRequest {
  const all = [...collection.requests, ...(collection.folders ?? []).flatMap(f => f.requests)];
  const r = all.find(x => x.name === name);
  if (!r) throw new Error(`no request named ${name}; have ${all.map(x => x.name).join(', ')}`);
  return r;
}

describe('importOpenApi — OpenAPI 3 petstore', () => {
  const { value, warnings } = importOpenApi(JSON.stringify(petstore));
  const { collection, variables } = value;

  it('names the collection from info', () => {
    expect(collection.name).toBe('Pet Store');
    expect(collection.description).toBe('Pets API');
  });

  it('makes one folder per first tag, in declared tag order, and keeps untagged requests at the root', () => {
    expect(collection.folders?.map(f => f.name)).toEqual(['store', 'pet']);
    expect(collection.folders?.[0]?.requests.map(r => r.name)).toEqual(['Place order']);
    expect(collection.folders?.[1]?.requests.map(r => r.name)).toEqual([
      'List pets', 'createPet', 'Get a pet', 'DELETE /pets/{petId}', 'Upload photo',
    ]);
    expect(collection.requests.map(r => r.name)).toEqual(['Health check', 'login', 'PUT /users/{user-id}/notes']);
  });

  it('returns baseUrl with server variables substituted, path params and auth variables', () => {
    expect(variables).toEqual([
      { key: 'baseUrl', value: 'https://api.petstore.test/v2', enabled: true },
      { key: 'bearerToken', value: '', enabled: true },
      { key: 'apiKey', value: '', enabled: true },
      { key: 'petId', value: 'rex-42', enabled: true },
      { key: 'username', value: '', enabled: true },
      { key: 'password', value: '', enabled: true },
      { key: 'user_id', value: '', enabled: true },
    ]);
  });

  it('builds query params (enabled only if required) and appends enabled ones to the URL', () => {
    const r = find(collection, 'List pets');
    expect(r.method).toBe('GET');
    expect(r.url).toBe('{{baseUrl}}/pets?limit=20');
    expect(r.params).toEqual([
      { key: 'limit', value: '20', enabled: true },
      { key: 'status', value: 'available', enabled: false },
    ]);
  });

  it('adds header params (resolving $ref) but ignores Accept in OpenAPI 3', () => {
    const r = find(collection, 'List pets');
    expect(r.headers).toEqual([{ key: 'X-Trace-Id', value: '', enabled: true }]);
  });

  it('uses global security by default', () => {
    expect(find(collection, 'List pets').auth).toEqual({ type: 'bearer', token: '{{bearerToken}}' });
    expect(find(collection, 'Upload photo').auth).toEqual({ type: 'bearer', token: '{{bearerToken}}' });
  });

  it('uses operation security: api key header, basic, and explicit none', () => {
    expect(find(collection, 'createPet').auth).toEqual({ type: 'api-key', headerName: 'X-API-Key', headerValue: '{{apiKey}}' });
    expect(find(collection, 'Health check').auth).toEqual({ type: 'basic', username: '{{username}}', password: '{{password}}' });
    expect(find(collection, 'DELETE /pets/{petId}').auth).toEqual({ type: 'none' });
  });

  it('prefers a supported alternative over OAuth 2, and falls back to bearer with a warning', () => {
    expect(find(collection, 'Get a pet').auth).toEqual({
      type: 'api-key', headerName: 'api_key', headerValue: '{{apiKey}}', apiKeyIn: 'query',
    });
    expect(find(collection, 'login').auth).toEqual({ type: 'bearer', token: '{{bearerToken}}' });
    expect(warnings.some(w => w.includes('OAuth 2'))).toBe(true);
  });

  it('turns path params into variables in the URL', () => {
    expect(find(collection, 'Get a pet').url).toBe('{{baseUrl}}/pets/{{petId}}');
    expect(find(collection, 'PUT /users/{user-id}/notes').url).toBe('{{baseUrl}}/users/{{user_id}}/notes');
  });

  it('generates a JSON body from $ref, allOf, enum, formats, oneOf, readOnly and a recursive schema', () => {
    const r = find(collection, 'createPet');
    expect(r.bodyType).toBe('json');
    expect(JSON.parse(r.body)).toEqual({
      name: 'Rex',
      birthday: '2024-01-01',
      owner: 'user@example.com',
      kind: 'dog',
      category: { name: 'string' },
      microchip: '00000000-0000-4000-8000-000000000000',
      weight: 1,
      vaccinated: true,
      tags: [{ label: 'friendly' }],
    });
    expect(r.body).toContain('\n  "name": "Rex"');
    expect(r.headers).toEqual([]);
  });

  it('uses the first of examples for a JSON body', () => {
    expect(JSON.parse(find(collection, 'login').body)).toEqual({ user: 'ken', pass: 'x' });
  });

  it('builds form fields from schema properties', () => {
    const r = find(collection, 'Place order');
    expect(r.bodyType).toBe('form');
    expect(r.formFields).toEqual([
      { key: 'petId', value: '7', enabled: true },
      { key: 'quantity', value: '1', enabled: true },
      { key: 'shipDate', value: '2024-01-01T00:00:00Z', enabled: true },
    ]);
  });

  it('builds multipart fields, with binary properties as file fields', () => {
    const r = find(collection, 'Upload photo');
    expect(r.bodyType).toBe('multipart');
    expect(r.multipartFields).toEqual([
      { key: 'caption', value: 'Rex at the beach', enabled: true, kind: 'text' },
      { key: 'file', value: '', enabled: true, kind: 'file' },
    ]);
  });

  it('uses text bodies with textContentType for other media types', () => {
    const r = find(collection, 'PUT /users/{user-id}/notes');
    expect(r.bodyType).toBe('text');
    expect(r.textContentType).toBe('application/xml');
    expect(r.body).toBe('<note/>');
  });

  it('warns about cookie parameters and callbacks', () => {
    expect(warnings.some(w => w.includes('Cookie parameters') && w.includes('session'))).toBe(true);
    expect(warnings).toContain('Callbacks are not imported.');
  });
});

describe('importOpenApi — Swagger 2', () => {
  const swagger = {
    swagger: '2.0',
    info: { title: 'Legacy API' },
    host: 'legacy.example.com',
    basePath: '/api/',
    schemes: ['http', 'https'],
    consumes: ['application/json'],
    securityDefinitions: {
      basic: { type: 'basic' },
      key: { type: 'apiKey', in: 'header', name: 'X-Key' },
      oauth: { type: 'oauth2', flow: 'implicit', authorizationUrl: 'https://auth.test' },
    },
    security: [{ key: [] }],
    tags: [{ name: 'users' }],
    paths: {
      '/users': {
        post: {
          tags: ['users'],
          summary: 'Create user',
          parameters: [{ in: 'body', name: 'body', schema: { $ref: '#/definitions/User' } }],
        },
        get: {
          tags: ['users'],
          operationId: 'listUsers',
          parameters: [
            { name: 'page', in: 'query', type: 'integer', default: 1, required: true },
            { name: 'q', in: 'query', type: 'string', 'x-example': 'a&b' },
            { name: 'Authorization', in: 'header', type: 'string' },
          ],
        },
      },
      '/users/{id}/avatar': {
        post: {
          tags: ['users'],
          summary: 'Upload avatar',
          consumes: ['multipart/form-data'],
          parameters: [
            { name: 'id', in: 'path', required: true, type: 'integer', 'x-example': 5 },
            { name: 'file', in: 'formData', type: 'file' },
            { name: 'alt', in: 'formData', type: 'string', default: 'avatar' },
          ],
          security: [{ basic: [] }],
        },
      },
      '/login': {
        post: {
          summary: 'Log in',
          consumes: ['application/x-www-form-urlencoded'],
          parameters: [
            { name: 'username', in: 'formData', type: 'string', required: true },
            { name: 'remember', in: 'formData', type: 'boolean', enum: [true, false] },
          ],
          security: [{ oauth: [] }],
        },
      },
    },
    definitions: {
      User: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          roles: { type: 'array', items: { type: 'string', enum: ['admin', 'user'] } },
        },
      },
    },
  };

  const { value, warnings } = importOpenApi(swagger);
  const { collection, variables } = value;

  it('builds baseUrl from schemes, host and basePath', () => {
    expect(variables[0]).toEqual({ key: 'baseUrl', value: 'http://legacy.example.com/api', enabled: true });
    expect(variables.map(v => v.key)).toEqual(['baseUrl', 'apiKey', 'id', 'username', 'password', 'bearerToken']);
    expect(variables.find(v => v.key === 'id')?.value).toBe('5');
  });

  it('reads in: body with a $ref to definitions', () => {
    const r = find(collection, 'Create user');
    expect(r.url).toBe('{{baseUrl}}/users');
    expect(r.bodyType).toBe('json');
    expect(JSON.parse(r.body)).toEqual({ name: 'string', email: 'user@example.com', roles: ['admin'] });
    expect(r.auth).toEqual({ type: 'api-key', headerName: 'X-Key', headerValue: '{{apiKey}}' });
  });

  it('reads parameter-level default and x-example, escaping & in the URL', () => {
    const r = find(collection, 'listUsers');
    expect(r.url).toBe('{{baseUrl}}/users?page=1');
    expect(r.params).toEqual([
      { key: 'page', value: '1', enabled: true },
      { key: 'q', value: 'a&b', enabled: false },
    ]);
    expect(r.headers).toEqual([{ key: 'Authorization', value: '', enabled: false }]);
  });

  it('reads formData as multipart when consumes says so, with file fields', () => {
    const r = find(collection, 'Upload avatar');
    expect(r.url).toBe('{{baseUrl}}/users/{{id}}/avatar');
    expect(r.bodyType).toBe('multipart');
    expect(r.multipartFields).toEqual([
      { key: 'file', value: '', enabled: true, kind: 'file' },
      { key: 'alt', value: 'avatar', enabled: true, kind: 'text' },
    ]);
    expect(r.auth).toEqual({ type: 'basic', username: '{{username}}', password: '{{password}}' });
  });

  it('reads formData as urlencoded form otherwise, and OAuth 2 falls back to bearer', () => {
    const r = find(collection, 'Log in');
    expect(r.bodyType).toBe('form');
    expect(r.formFields).toEqual([
      { key: 'username', value: '', enabled: true },
      { key: 'remember', value: 'true', enabled: true },
    ]);
    expect(r.auth.type).toBe('bearer');
    expect(warnings.some(w => w.includes('OAuth 2'))).toBe(true);
  });

  it('puts tagged operations in folders', () => {
    expect(collection.folders?.map(f => [f.name, f.requests.length])).toEqual([['users', 3]]);
    expect(collection.requests.map(r => r.name)).toEqual(['Log in']);
  });

  it('url-escapes the query value the way the URL field would', () => {
    const doc = { swagger: '2.0', host: 'h.test', paths: { '/s': { get: { parameters: [{ name: 'q', in: 'query', required: true, 'x-example': 'a&b#c' }] } } } };
    const r = importOpenApi(doc).value.collection.requests[0];
    expect(r?.url).toBe('https://h.test/s'.replace('https://h.test', '{{baseUrl}}') + '?q=a%26b%23c');
    expect(r?.params).toEqual([{ key: 'q', value: 'a&b#c', enabled: true }]);
    expect(importOpenApi(doc).value.variables[0]?.value).toBe('https://h.test');
  });
});

describe('importOpenApi — input handling', () => {
  it('rejects YAML with a helpful message', () => {
    const yaml = 'openapi: 3.0.0\ninfo:\n  title: Test\npaths: {}\n';
    expect(() => importOpenApi(yaml)).toThrow('This looks like YAML. Paste the JSON form of the spec (most tools can export it).');
    expect(() => importOpenApi('---\nswagger: "2.0"')).toThrow(/YAML/);
  });

  it('rejects invalid JSON and non-OpenAPI JSON', () => {
    expect(() => importOpenApi('{"openapi": ')).toThrow(/not valid JSON/);
    expect(() => importOpenApi('{"info": {"title": "x"}}')).toThrow(/not an OpenAPI 3 or Swagger 2/);
    expect(() => importOpenApi('[1,2]')).toThrow(/JSON object/);
    expect(() => importOpenApi('')).toThrow(/Paste an OpenAPI/);
  });

  it('accepts a minimal document without throwing', () => {
    const { value, warnings } = importOpenApi({ openapi: '3.1.0' });
    expect(value.collection.name).toBe('Imported API');
    expect(value.collection.requests).toEqual([]);
    expect(value.collection.folders).toEqual([]);
    expect(value.variables).toEqual([{ key: 'baseUrl', value: '', enabled: true }]);
    expect(warnings.some(w => w.includes('no paths'))).toBe(true);
    expect(warnings.some(w => w.includes('no servers'))).toBe(true);
  });

  it('survives malformed optional fields', () => {
    const doc = {
      openapi: '3.0.0',
      info: 'nope',
      servers: 'x',
      tags: 5,
      security: 'bad',
      paths: {
        '/a': { get: 'nope', post: { parameters: 'bad', requestBody: 5, tags: 'x', security: [{ missing: [] }] } },
        '/b': null,
        '/c': { get: { parameters: [null, { in: 'query' }, { name: 'x', in: 'query', schema: { $ref: '#/nowhere' } }] } },
        '/d': { get: { requestBody: { content: { 'application/json': { schema: { $ref: 'other.json#/X' } } } } } },
        '/e': { trace: {} },
      },
    };
    const { value, warnings } = importOpenApi(doc);
    const names = value.collection.requests.map(r => r.name);
    expect(names).toEqual(['POST /a', 'GET /c', 'GET /d']);
    expect(warnings.some(w => w.includes('"missing" is not defined'))).toBe(true);
    expect(warnings.some(w => w.includes('#/nowhere'))).toBe(true);
    expect(warnings.some(w => w.includes('External references'))).toBe(true);
    expect(warnings.some(w => w.includes('TRACE'))).toBe(true);
  });

  it('keeps a relative server URL and adds a Content-Type header for vendor JSON', () => {
    const doc = {
      openapi: '3.0.0',
      servers: [{ url: '/api/v3' }],
      paths: {
        '/x': {
          patch: {
            requestBody: { content: { 'application/merge-patch+json': { schema: { type: 'object', properties: { a: { type: 'string', example: 'b' } } } } } },
          },
        },
      },
    };
    const { value } = importOpenApi(doc);
    expect(value.variables[0]?.value).toBe('/api/v3');
    const r = value.collection.requests[0];
    expect(r?.headers).toEqual([{ key: 'Content-Type', value: 'application/merge-patch+json', enabled: true }]);
    expect(JSON.parse(r?.body ?? '')).toEqual({ a: 'b' });
  });

  it('stops at the depth limit on deeply nested non-recursive schemas', () => {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 30; i++) schema = { type: 'object', properties: { n: schema } };
    const doc = { openapi: '3.0.0', paths: { '/deep': { post: { requestBody: { content: { 'application/json': { schema } } } } } } };
    const body = importOpenApi(doc).value.collection.requests[0]?.body ?? '';
    expect(() => JSON.parse(body)).not.toThrow();
    expect(body.length).toBeLessThan(1000);
  });

  it('uses an operation-level server instead of baseUrl', () => {
    const doc = {
      openapi: '3.0.0',
      servers: [{ url: 'https://main.test' }],
      paths: { '/up': { post: { servers: [{ url: 'https://upload.test/' }] } } },
    };
    expect(importOpenApi(doc).value.collection.requests[0]?.url).toBe('https://upload.test/up');
  });
});
