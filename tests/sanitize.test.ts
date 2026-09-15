import { describe, it, expect } from 'vitest';
import {
  sanitizeKeyValues, sanitizeRequest, sanitizeEnvironment, sanitizeCollection, sanitizeHistoryEntry, sanitizeList,
} from '../utils/sanitize';
import { newRequest } from '../utils/request';
import type { ApiRequest } from '../utils/request';
import type { Collection } from '../utils/collections';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, value: `v${i}`, enabled: true }));

describe('sanitizeRequest', () => {
  it.each([null, undefined, 'request', 42, true, [], [{ url: 'x' }]])('returns null for %j', v => {
    expect(sanitizeRequest(v)).toBeNull();
  });

  it('fills defaults for an empty object', () => {
    const r = sanitizeRequest({})!;
    expect(typeof r.id).toBe('string');
    expect(r.id).not.toBe('');
    expect(r).toEqual({
      id: r.id,
      name: 'New Request',
      method: 'GET',
      url: '',
      headers: [],
      params: [],
      body: '',
      bodyType: 'none',
      auth: { type: 'none' },
    });
    for (const k of ['textContentType', 'formFields', 'multipartFields', 'binaryFile', 'graphqlVariables']) {
      expect(k in r).toBe(false);
    }
  });

  it('generates an id when the id is empty or not a string', () => {
    expect(sanitizeRequest({ id: '' })!.id).not.toBe('');
    expect(typeof sanitizeRequest({ id: 7 })!.id).toBe('string');
    expect(sanitizeRequest({ id: 'keep' })!.id).toBe('keep');
  });

  it('keeps a complete, valid request unchanged', () => {
    const full: ApiRequest = {
      id: 'r1',
      name: 'Upload',
      method: 'POST',
      url: '{{baseUrl}}/upload?x=1',
      headers: [{ key: 'X-A', value: '1', enabled: false }],
      params: [{ key: 'x', value: '1', enabled: true }],
      body: 'query { a }',
      bodyType: 'multipart',
      textContentType: 'text/csv',
      formFields: [{ key: 'f', value: 'v', enabled: true }],
      multipartFields: [
        { key: 'doc', value: '', enabled: true, kind: 'file', file: { id: 'file1', name: 'a.pdf', size: 10, type: 'application/pdf' } },
        { key: 'title', value: 'T', enabled: true, kind: 'text' },
      ],
      binaryFile: { id: 'file2', name: 'b.bin', size: 0, type: '' },
      graphqlVariables: '{"a":1}',
      auth: { type: 'api-key', headerName: 'X-Key', headerValue: 'v', apiKeyIn: 'query' },
    };
    expect(sanitizeRequest(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });

  it('keeps a newRequest() unchanged', () => {
    const r = newRequest();
    expect(sanitizeRequest(r)).toEqual(r);
  });

  it.each<[unknown, string]>([
    ['TRACE', 'GET'],
    ['CONNECT', 'GET'],
    ['post', 'POST'],
    ['Patch', 'PATCH'],
    ['delete', 'DELETE'],
    [42, 'GET'],
    [null, 'GET'],
    ['', 'GET'],
    [' GET', 'GET'],
  ])('method %j becomes %s', (method, expected) => {
    expect(sanitizeRequest({ method })!.method).toBe(expected);
  });

  it('turns an unknown bodyType into none and keeps known ones', () => {
    expect(sanitizeRequest({ bodyType: 'xml' })!.bodyType).toBe('none');
    expect(sanitizeRequest({ bodyType: 'JSON' })!.bodyType).toBe('none');
    expect(sanitizeRequest({ bodyType: 7 })!.bodyType).toBe('none');
    for (const t of ['none', 'json', 'form', 'multipart', 'text', 'binary', 'graphql']) {
      expect(sanitizeRequest({ bodyType: t })!.bodyType).toBe(t);
    }
  });

  it('drops unknown fields', () => {
    const r = sanitizeRequest({ url: 'x', evil: '<script>', proUnlocked: true, response: {}, auth: { type: 'bearer', token: 't', secret: 's' } })!;
    expect(Object.keys(r).sort()).toEqual(['auth', 'body', 'bodyType', 'headers', 'id', 'method', 'name', 'params', 'url']);
    expect(r.auth).toEqual({ type: 'bearer', token: 't' });
  });

  it('coerces numbers and booleans to strings, and other values to defaults', () => {
    const r = sanitizeRequest({
      name: 5,
      url: 123,
      body: { a: 1 },
      headers: [{ key: 1, value: 2 }, { key: true, value: null }, { key: ['x'], value: 3.5, enabled: 'false' }],
    })!;
    expect(r.name).toBe('5');
    expect(r.url).toBe('123');
    expect(r.body).toBe('');
    expect(r.headers).toEqual([
      { key: '1', value: '2', enabled: true },
      { key: 'true', value: '', enabled: true },
      { key: '', value: '3.5', enabled: true },
    ]);
  });

  it('drops non-object rows', () => {
    const r = sanitizeRequest({ params: [null, 'a=b', ['a', 'b'], 5, { key: 'q', value: '1', enabled: false }] })!;
    expect(r.params).toEqual([{ key: 'q', value: '1', enabled: false }]);
  });

  it('treats non-array row lists as empty', () => {
    const r = sanitizeRequest({ headers: { key: 'a' }, params: 'a=1' })!;
    expect(r.headers).toEqual([]);
    expect(r.params).toEqual([]);
  });

  it('caps headers, params, form fields and multipart fields at 500 rows', () => {
    const multipart = Array.from({ length: 600 }, (_, i) => ({ key: `m${i}`, value: '', enabled: true, kind: 'text' }));
    const r = sanitizeRequest({ headers: rows(600), params: rows(501), formFields: rows(1000), multipartFields: multipart })!;
    expect(r.headers).toHaveLength(500);
    expect(r.params).toHaveLength(500);
    expect(r.formFields).toHaveLength(500);
    expect(r.multipartFields).toHaveLength(500);
    expect(r.headers[499]!.key).toBe('k499');
    expect(sanitizeRequest({ headers: rows(500) })!.headers).toHaveLength(500);
  });

  it('drops a binary file ref without an id and normalizes one with an id', () => {
    expect('binaryFile' in sanitizeRequest({ binaryFile: { name: 'a.png', size: 5, type: 'image/png' } })!).toBe(false);
    expect('binaryFile' in sanitizeRequest({ binaryFile: { id: '', name: 'a.png' } })!).toBe(false);
    expect('binaryFile' in sanitizeRequest({ binaryFile: 'file-id' })!).toBe(false);
    expect(sanitizeRequest({ binaryFile: { id: 'f1', size: -5, extra: 1 } })!.binaryFile).toEqual({ id: 'f1', name: 'file', size: 0, type: '' });
    expect(sanitizeRequest({ binaryFile: { id: 'f1', name: 'a', size: 'big', type: 'x/y' } })!.binaryFile).toEqual({ id: 'f1', name: 'a', size: 0, type: 'x/y' });
    expect(sanitizeRequest({ binaryFile: { id: 'f1', size: Infinity } })!.binaryFile!.size).toBe(0);
  });

  it('normalizes multipart kinds and file refs', () => {
    const r = sanitizeRequest({
      multipartFields: [
        { key: 'a', kind: 'file', file: { id: 'f1', name: 'x.txt', size: 3, type: 'text/plain' } },
        { key: 'b', kind: 'file', file: { name: 'no-id.txt' } },
        { key: 'c', kind: 'text', file: { id: 'f2' } },
        { key: 'd', kind: 'video' },
        { key: 'e' },
      ],
    })!;
    expect(r.multipartFields).toEqual([
      { key: 'a', value: '', enabled: true, kind: 'file', file: { id: 'f1', name: 'x.txt', size: 3, type: 'text/plain' } },
      { key: 'b', value: '', enabled: true, kind: 'file' },
      { key: 'c', value: '', enabled: true, kind: 'text' },
      { key: 'd', value: '', enabled: true, kind: 'text' },
      { key: 'e', value: '', enabled: true, kind: 'text' },
    ]);
  });

  it('sanitizes auth', () => {
    expect(sanitizeRequest({ auth: null })!.auth).toEqual({ type: 'none' });
    expect(sanitizeRequest({ auth: { type: 'digest', token: 't' } })!.auth).toEqual({ type: 'none', token: 't' });
    expect(sanitizeRequest({ auth: { type: 'basic', username: 'u', password: 123 } })!.auth).toEqual({ type: 'basic', username: 'u' });
    expect(sanitizeRequest({ auth: { type: 'api-key', apiKeyIn: 'cookie' } })!.auth).toEqual({ type: 'api-key' });
    expect(sanitizeRequest({ auth: { type: 'api-key', apiKeyIn: 'header' } })!.auth).toEqual({ type: 'api-key', apiKeyIn: 'header' });
  });

  it('omits an empty textContentType but keeps an empty graphqlVariables string', () => {
    const r = sanitizeRequest({ textContentType: '', graphqlVariables: '' })!;
    expect('textContentType' in r).toBe(false);
    expect(r.graphqlVariables).toBe('');
    expect('graphqlVariables' in sanitizeRequest({ graphqlVariables: { a: 1 } })!).toBe(false);
  });

  it('only sets formFields and multipartFields when they are arrays', () => {
    const r = sanitizeRequest({ formFields: 'a=1', multipartFields: null })!;
    expect('formFields' in r).toBe(false);
    expect('multipartFields' in r).toBe(false);
    expect(sanitizeRequest({ formFields: [] })!.formFields).toEqual([]);
  });

  it('ignores an own __proto__ key from JSON', () => {
    const r = sanitizeRequest(JSON.parse('{"__proto__":{"method":"POST","url":"evil"}}'))!;
    expect(r.method).toBe('GET');
    expect(r.url).toBe('');
  });
});

describe('sanitizeKeyValues', () => {
  it('defaults enabled to true only when it is not a boolean', () => {
    expect(sanitizeKeyValues([{ key: 'a', enabled: false }, { key: 'b', enabled: 0 }])).toEqual([
      { key: 'a', value: '', enabled: false },
      { key: 'b', value: '', enabled: true },
    ]);
  });

  it('applies the 500-row cap before dropping non-objects', () => {
    const input: unknown[] = [...Array.from({ length: 500 }, () => null), { key: 'late' }];
    expect(sanitizeKeyValues(input)).toEqual([]);
  });
});

describe('sanitizeEnvironment', () => {
  it.each([null, undefined, 'env', 3, []])('returns null for %j', v => {
    expect(sanitizeEnvironment(v)).toBeNull();
  });

  it('fills defaults', () => {
    const e = sanitizeEnvironment({})!;
    expect(e).toEqual({ id: e.id, name: 'Environment', variables: [] });
    expect(e.id).not.toBe('');
  });

  it('sanitizes variables and drops unknown fields', () => {
    const e = sanitizeEnvironment({
      id: 'e1',
      name: 'Dev',
      color: 'red',
      variables: [{ key: 'port', value: 8080 }, null, { key: 'off', value: 'x', enabled: false, secret: true }],
    })!;
    expect(e).toEqual({
      id: 'e1',
      name: 'Dev',
      variables: [
        { key: 'port', value: '8080', enabled: true },
        { key: 'off', value: 'x', enabled: false, secret: true },
      ],
    });
  });

  it('keeps secret only when it is exactly true', () => {
    const e = sanitizeEnvironment({
      variables: [
        { key: 'a', value: '1', secret: true },
        { key: 'b', value: '2', secret: 'true' },
        { key: 'c', value: '3', secret: 1 },
        { key: 'd', value: '4', secret: false },
      ],
    })!;
    expect(e.variables[0]).toEqual({ key: 'a', value: '1', enabled: true, secret: true });
    for (const v of e.variables.slice(1)) expect('secret' in v).toBe(false);
  });

  it('keeps a valid environment with secrets unchanged', () => {
    const env = { id: 'e1', name: 'Prod', variables: [{ key: 'token', value: 't', enabled: true, secret: true }, { key: 'url', value: 'u', enabled: false }] };
    expect(sanitizeEnvironment(JSON.parse(JSON.stringify(env)))).toEqual(env);
  });

  it('treats non-array variables as empty and caps at 500', () => {
    expect(sanitizeEnvironment({ variables: { a: 1 } })!.variables).toEqual([]);
    expect(sanitizeEnvironment({ variables: rows(700) })!.variables).toHaveLength(500);
  });
});

describe('sanitizeCollection', () => {
  it.each([null, 'c', 1, []])('returns null for %j', v => {
    expect(sanitizeCollection(v)).toBeNull();
  });

  it('fills defaults with timestamps of now', () => {
    const before = Date.now();
    const c = sanitizeCollection({})!;
    const after = Date.now();
    expect(c.name).toBe('Collection');
    expect(c.description).toBe('');
    expect(c.requests).toEqual([]);
    expect(c.created).toBeGreaterThanOrEqual(before);
    expect(c.created).toBeLessThanOrEqual(after);
    expect(c.updated).toBe(c.created);
  });

  it('keeps valid fields and sanitizes requests, dropping malformed ones', () => {
    const c = sanitizeCollection({
      id: 'c1',
      name: 'API',
      description: 'desc',
      created: 100,
      updated: 200,
      owner: 'x',
      requests: [{ id: 'r1', url: 'https://a.com', method: 'put' }, null, 'bad', [], { id: 'r2' }],
    })!;
    expect(Object.keys(c).sort()).toEqual(['created', 'description', 'id', 'name', 'requests', 'updated']);
    expect(c.id).toBe('c1');
    expect(c.created).toBe(100);
    expect(c.updated).toBe(200);
    expect(c.requests.map(r => r.id)).toEqual(['r1', 'r2']);
    expect(c.requests[0]!.method).toBe('PUT');
  });

  it('replaces non-numeric timestamps and non-array requests', () => {
    const c = sanitizeCollection({ created: '100', updated: NaN, requests: { r: 1 } })!;
    expect(c.created).not.toBe('100');
    expect(Number.isFinite(c.updated)).toBe(true);
    expect(c.requests).toEqual([]);
  });

  it('keeps a valid collection with folders unchanged', () => {
    const full: Collection = {
      id: 'c1',
      name: 'API',
      description: '',
      requests: [newRequest('Root')],
      folders: [
        { id: 'f1', name: 'Users', requests: [newRequest('List'), { ...newRequest('Create'), method: 'POST' }] },
        { id: 'f2', name: 'Empty', requests: [] },
      ],
      created: 100,
      updated: 200,
    };
    expect(sanitizeCollection(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });

  it('sanitizes folders, dropping malformed ones and filling defaults', () => {
    const c = sanitizeCollection({
      id: 'c1',
      folders: [
        { id: 'f1', name: 'Users', requests: [{ id: 'r1', method: 'delete' }, null, 'bad'], color: 'red' },
        null,
        'folder',
        ['f'],
        7,
        { requests: 'nope' },
        { id: '', name: 12, requests: [{ id: 'r2' }] },
      ],
    })!;
    expect(c.folders).toHaveLength(3);
    const [a, b, d] = c.folders!;
    expect(Object.keys(a!).sort()).toEqual(['id', 'name', 'requests']);
    expect(a!.id).toBe('f1');
    expect(a!.name).toBe('Users');
    expect(a!.requests.map(r => [r.id, r.method])).toEqual([['r1', 'DELETE']]);
    expect(b!.name).toBe('Folder');
    expect(b!.id).toBeTruthy();
    expect(b!.requests).toEqual([]);
    expect(d!.id).not.toBe('');
    expect(d!.name).toBe('12');
    expect(d!.requests.map(r => r.id)).toEqual(['r2']);
  });

  it('only sets folders when they are an array', () => {
    expect('folders' in sanitizeCollection({ folders: { f: 1 } })!).toBe(false);
    expect('folders' in sanitizeCollection({ folders: null })!).toBe(false);
    expect(sanitizeCollection({ folders: [] })!.folders).toEqual([]);
  });
});

describe('sanitizeHistoryEntry', () => {
  it.each([null, 'h', 1, [], {}, { request: null }, { request: 'GET /' }])('returns null for %j', v => {
    expect(sanitizeHistoryEntry(v)).toBeNull();
  });

  it('fills a missing response with zeros and a missing timestamp with now', () => {
    const before = Date.now();
    const h = sanitizeHistoryEntry({ request: { url: 'https://a.com' } })!;
    expect(h.response).toEqual({ status: 0, statusText: '', headers: {}, body: '', size: 0, time: 0, contentType: '' });
    expect(h.timestamp).toBeGreaterThanOrEqual(before);
    expect(h.request.url).toBe('https://a.com');
  });

  it('keeps a valid entry and drops non-string response headers and non-numeric numbers', () => {
    const h = sanitizeHistoryEntry({
      id: 'h1',
      timestamp: 1700000000000,
      request: { id: 'r1', url: 'https://a.com' },
      response: {
        status: '200',
        statusText: 'OK',
        headers: { 'content-type': 'application/json', 'x-num': 5, 'x-obj': {} },
        body: '{}',
        size: 2,
        time: 12,
        contentType: 'application/json',
        extra: 'dropped',
      },
    })!;
    expect(h.id).toBe('h1');
    expect(h.timestamp).toBe(1700000000000);
    expect(h.response).toEqual({
      status: 0,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      size: 2,
      time: 12,
      contentType: 'application/json',
    });
  });
});

describe('sanitizeList', () => {
  it('returns nothing for a non-array', () => {
    expect(sanitizeList({ a: 1 }, sanitizeEnvironment)).toEqual({ items: [], dropped: 0 });
    expect(sanitizeList(undefined, sanitizeEnvironment)).toEqual({ items: [], dropped: 0 });
  });

  it('counts dropped items', () => {
    const r = sanitizeList([{ id: 'e1' }, null, 'x', { id: 'e2' }, 5], sanitizeEnvironment);
    expect(r.items.map(e => e.id)).toEqual(['e1', 'e2']);
    expect(r.dropped).toBe(3);
  });

  it('reports zero dropped for a clean list', () => {
    expect(sanitizeList([{}, {}], sanitizeCollection).dropped).toBe(0);
  });
});
