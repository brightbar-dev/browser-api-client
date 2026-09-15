import { describe, it, expect } from 'vitest';
import {
  resolveRequest, encodeUrlencoded, isForbiddenHeader, isValidHeaderName, methodAllowsBody, findHeader,
} from '../utils/resolve';
import { newRequest } from '../utils/request';
import type { ApiRequest, FileRef, KeyValuePair, MultipartField, ResolvedBody } from '../utils/request';
import type { EnvVariable } from '../utils/environment';

function req(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return { ...newRequest(), url: 'https://api.example.com/items', ...overrides };
}

function vars(record: Record<string, string>): EnvVariable[] {
  return Object.entries(record).map(([key, value]) => ({ key, value, enabled: true }));
}

const kv = (key: string, value: string, enabled = true): KeyValuePair => ({ key, value, enabled });

function textOf(body: ResolvedBody): string {
  if (body.kind !== 'text') throw new Error(`expected a text body, got ${body.kind}`);
  return body.text;
}

const file: FileRef = { id: 'f1', name: 'photo.png', size: 1234, type: 'image/png' };

describe('resolveRequest — URL and variables', () => {
  it('interpolates variables in the URL and params', () => {
    const r = resolveRequest(
      req({ url: '{{baseUrl}}/users/{{id}}', params: [kv('q', '{{term}}')] }),
      vars({ baseUrl: 'https://api.example.com', id: '42', term: 'hello' }),
    );
    expect(r.request.url).toBe('https://api.example.com/users/42?q=hello');
    expect(r.unresolved).toEqual([]);
    expect(r.error).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('uses the params table, not the URL text, as the query', () => {
    const r = resolveRequest(req({ url: 'https://api.example.com/x?stale=1', params: [kv('fresh', '1'), kv('off', '1', false)] }), []);
    expect(r.request.url).toBe('https://api.example.com/x?fresh=1');
  });

  it('adds a default scheme', () => {
    expect(resolveRequest(req({ url: 'api.example.com/x' }), []).request.url).toBe('https://api.example.com/x');
    expect(resolveRequest(req({ url: 'localhost:3000/x' }), []).request.url).toBe('http://localhost:3000/x');
  });

  it('passes the method through', () => {
    expect(resolveRequest(req({ method: 'PATCH' }), []).request.method).toBe('PATCH');
  });

  it('lists unresolved variables once each, from every part of the request', () => {
    const r = resolveRequest(
      req({
        method: 'POST',
        url: 'https://api.example.com/{{version}}/x',
        params: [kv('k', '{{version}}')],
        headers: [kv('X-Trace', '{{traceId}}')],
        bodyType: 'json',
        body: '{"a": "{{bodyVar}}"}',
      }),
      [],
    );
    expect([...r.unresolved].sort()).toEqual(['bodyVar', 'traceId', 'version']);
  });

  it('treats disabled variables as unresolved and leaves the placeholder', () => {
    const r = resolveRequest(req({ headers: [kv('X-Key', '{{key}}')] }), [{ key: 'key', value: 'secret', enabled: false }]);
    expect(r.unresolved).toEqual(['key']);
    expect(findHeader(r.request.headers, 'X-Key')).toBe('{{key}}');
  });

  it('does not count variables in disabled headers or params', () => {
    const r = resolveRequest(req({ headers: [kv('X-A', '{{a}}', false)], params: [kv('b', '{{b}}', false)] }), []);
    expect(r.unresolved).toEqual([]);
  });

  it('sets error for an invalid URL and keeps the raw interpolated URL', () => {
    const r = resolveRequest(req({ url: '{{baseUrl}}/users' }), []);
    expect(r.error).toBe('"{{baseUrl}}/users" is not a valid URL.');
    expect(r.request.url).toBe('{{baseUrl}}/users');
    expect(r.unresolved).toEqual(['baseUrl']);
  });

  it('sets error for a non-http scheme', () => {
    const r = resolveRequest(req({ url: 'ftp://files.example.com/a' }), []);
    expect(r.error).toMatch(/Only http and https/);
  });

  it('sets error for an empty URL', () => {
    expect(resolveRequest(req({ url: '' }), []).error).toBe('Enter a URL to send the request to.');
  });
});

describe('resolveRequest — headers', () => {
  it('interpolates header names and values, trims names, keeps order and repeats', () => {
    const r = resolveRequest(
      req({
        headers: [
          kv('  X-{{name}}  ', '{{val}}'),
          kv('Accept', 'application/json'),
          kv('Accept', 'text/plain'),
          kv('X-Disabled', 'nope', false),
          kv('   ', 'blank key'),
        ],
      }),
      vars({ name: 'Custom', val: 'v1' }),
    );
    expect(r.request.headers).toEqual([
      ['X-Custom', 'v1'],
      ['Accept', 'application/json'],
      ['Accept', 'text/plain'],
    ]);
  });

  it.each(['Host', 'Origin', 'Cookie', 'Sec-Fetch-Mode', 'Proxy-Authorization', 'content-length'])(
    'warns that the forbidden %s header will not be sent',
    name => {
      const r = resolveRequest(req({ headers: [kv(name, 'x')] }), []);
      expect(r.error).toBeUndefined();
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toBe(`The browser does not let extensions set the ${name} header, so it will not be sent.`);
    },
  );

  it('sets error for an invalid header name', () => {
    const r = resolveRequest(req({ headers: [kv('X Bad Name', 'v')] }), []);
    expect(r.error).toBe('"X Bad Name" is not a valid header name.');
    expect(r.request.headers).toEqual([['X Bad Name', 'v']]);
  });

  it('keeps the first error: an invalid URL wins over an invalid header name', () => {
    const r = resolveRequest(req({ url: 'ftp://x.com', headers: [kv('bad name', 'v'), kv('also:bad', 'v')] }), []);
    expect(r.error).toMatch(/got ftp/);
  });

  it('reports the first invalid header name when there are several', () => {
    const r = resolveRequest(req({ headers: [kv('bad name', 'v'), kv('also:bad', 'v')] }), []);
    expect(r.error).toBe('"bad name" is not a valid header name.');
  });

  it('sets error when a variable resolves a header name into an invalid one', () => {
    const r = resolveRequest(req({ headers: [kv('{{h}}', 'v')] }), vars({ h: 'X Spaced' }));
    expect(r.error).toBe('"X Spaced" is not a valid header name.');
  });
});

describe('resolveRequest — auth', () => {
  it('adds a bearer token with variables resolved', () => {
    const r = resolveRequest(req({ auth: { type: 'bearer', token: '{{tok}}' } }), vars({ tok: 'abc123' }));
    expect(r.request.headers).toEqual([['Authorization', 'Bearer abc123']]);
    expect(r.warnings).toEqual([]);
  });

  it('adds nothing for bearer without a token', () => {
    const r = resolveRequest(req({ auth: { type: 'bearer', token: '' } }), []);
    expect(r.request.headers).toEqual([]);
  });

  it('encodes basic credentials as UTF-8 base64', () => {
    const r = resolveRequest(req({ auth: { type: 'basic', username: 'jösé', password: 'pä$$' } }), []);
    const value = findHeader(r.request.headers, 'Authorization')!;
    expect(value.startsWith('Basic ')).toBe(true);
    const bytes = Uint8Array.from(atob(value.slice('Basic '.length)), c => c.charCodeAt(0));
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe('jösé:pä$$');
    // ö, é and ä are two bytes each in UTF-8.
    expect(bytes.length).toBe('jösé:pä$$'.length + 3);
  });

  it('interpolates basic credentials', () => {
    const r = resolveRequest(req({ auth: { type: 'basic', username: '{{u}}', password: '{{p}}' } }), vars({ u: 'user', p: 'pass' }));
    expect(findHeader(r.request.headers, 'authorization')).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('sends basic auth with only a password or only a username', () => {
    expect(findHeader(resolveRequest(req({ auth: { type: 'basic', password: 'secret' } }), []).request.headers, 'Authorization'))
      .toBe(`Basic ${btoa(':secret')}`);
    expect(findHeader(resolveRequest(req({ auth: { type: 'basic', username: 'user' } }), []).request.headers, 'Authorization'))
      .toBe(`Basic ${btoa('user:')}`);
  });

  it('adds nothing for basic with neither username nor password', () => {
    expect(resolveRequest(req({ auth: { type: 'basic' } }), []).request.headers).toEqual([]);
  });

  it('replaces a hand-set Authorization header and warns', () => {
    const r = resolveRequest(
      req({ headers: [kv('authorization', 'Bearer old'), kv('Accept', '*/*')], auth: { type: 'bearer', token: 'new' } }),
      [],
    );
    expect(r.request.headers).toEqual([['Accept', '*/*'], ['Authorization', 'Bearer new']]);
    expect(r.warnings).toEqual(['The Auth tab replaces the Authorization header you set on the Headers tab.']);
  });

  it('warns for basic auth replacing a hand-set Authorization header too', () => {
    const r = resolveRequest(req({ headers: [kv('Authorization', 'x')], auth: { type: 'basic', username: 'u', password: 'p' } }), []);
    expect(r.warnings).toContain('The Auth tab replaces the Authorization header you set on the Headers tab.');
  });

  it('keeps a hand-set Authorization header without a warning when auth is none', () => {
    const r = resolveRequest(req({ headers: [kv('Authorization', 'Token xyz')] }), []);
    expect(r.request.headers).toEqual([['Authorization', 'Token xyz']]);
    expect(r.warnings).toEqual([]);
  });

  it('does not claim to replace a hand-set Authorization header when bearer auth has no token', () => {
    const r = resolveRequest(req({ headers: [kv('Authorization', 'Token xyz')], auth: { type: 'bearer', token: '' } }), []);
    expect(r.request.headers).toEqual([['Authorization', 'Token xyz']]);
    expect(r.warnings).toEqual([]);
  });

  it('adds an API key header (header is the default location)', () => {
    const r = resolveRequest(req({ auth: { type: 'api-key', headerName: 'X-API-Key', headerValue: '{{key}}' } }), vars({ key: 's3cret' }));
    expect(r.request.headers).toEqual([['X-API-Key', 's3cret']]);
    expect(r.request.url).toBe('https://api.example.com/items');
  });

  it('replaces a same-named hand-set header case-insensitively with the API key', () => {
    const r = resolveRequest(
      req({ headers: [kv('x-api-key', 'old')], auth: { type: 'api-key', headerName: 'X-API-Key', headerValue: 'new', apiKeyIn: 'header' } }),
      [],
    );
    expect(r.request.headers).toEqual([['X-API-Key', 'new']]);
  });

  it('adds nothing for an API key without a name or value', () => {
    expect(resolveRequest(req({ auth: { type: 'api-key', headerName: 'X-Key' } }), []).request.headers).toEqual([]);
    expect(resolveRequest(req({ auth: { type: 'api-key', headerValue: 'v' } }), []).request.headers).toEqual([]);
  });

  it('sets error when the API key header name is not a valid header name', () => {
    const r = resolveRequest(req({ auth: { type: 'api-key', headerName: 'X API Key', headerValue: 'abc' } }), []);
    expect(r.error).toBeDefined();
  });

  it('appends an API key to the query instead of the headers', () => {
    const r = resolveRequest(req({ auth: { type: 'api-key', headerName: 'api_key', headerValue: '{{key}}', apiKeyIn: 'query' } }), vars({ key: 'abc' }));
    expect(r.request.url).toBe('https://api.example.com/items?api_key=abc');
    expect(r.request.headers).toEqual([]);
  });

  it('appends an API key after existing params and before the fragment, URI-encoded', () => {
    const r = resolveRequest(
      req({
        url: 'https://api.example.com/items?page=2#top',
        params: [kv('page', '2')],
        auth: { type: 'api-key', headerName: 'api key', headerValue: 'a&b=c', apiKeyIn: 'query' },
      }),
      [],
    );
    expect(r.request.url).toBe('https://api.example.com/items?page=2&api%20key=a%26b%3Dc#top');
  });
});

describe('resolveRequest — bodies', () => {
  it('json: interpolates and adds application/json', () => {
    const r = resolveRequest(req({ method: 'POST', bodyType: 'json', body: '{"name": "{{name}}"}' }), vars({ name: 'Ada' }));
    expect(r.request.body).toEqual({ kind: 'text', text: '{"name": "Ada"}' });
    expect(r.request.headers).toEqual([['Content-Type', 'application/json']]);
    expect(r.warnings).toEqual([]);
  });

  it('json: respects a user Content-Type (any case) and does not add another', () => {
    const r = resolveRequest(
      req({ method: 'POST', bodyType: 'json', body: '{}', headers: [kv('content-type', 'application/vnd.api+json')] }),
      [],
    );
    expect(r.request.headers).toEqual([['content-type', 'application/vnd.api+json']]);
  });

  it('json: warns about invalid JSON but still sends it', () => {
    const r = resolveRequest(req({ method: 'POST', bodyType: 'json', body: '{"a": 1,}' }), []);
    expect(r.warnings).toEqual(['The JSON body is not valid JSON.']);
    expect(textOf(r.request.body)).toBe('{"a": 1,}');
    expect(r.error).toBeUndefined();
  });

  it('json: does not warn about an empty or whitespace body', () => {
    expect(resolveRequest(req({ method: 'POST', bodyType: 'json', body: '  \n' }), []).warnings).toEqual([]);
  });

  it('text: defaults to text/plain', () => {
    const r = resolveRequest(req({ method: 'PUT', bodyType: 'text', body: 'hello {{who}}' }), vars({ who: 'world' }));
    expect(r.request.body).toEqual({ kind: 'text', text: 'hello world' });
    expect(r.request.headers).toEqual([['Content-Type', 'text/plain']]);
  });

  it('text: uses textContentType', () => {
    const r = resolveRequest(req({ method: 'POST', bodyType: 'text', body: '<a/>', textContentType: 'application/xml' }), []);
    expect(r.request.headers).toEqual([['Content-Type', 'application/xml']]);
  });

  it('text: a user Content-Type beats textContentType', () => {
    const r = resolveRequest(
      req({ method: 'POST', bodyType: 'text', body: 'x', textContentType: 'application/xml', headers: [kv('Content-Type', 'text/csv')] }),
      [],
    );
    expect(r.request.headers).toEqual([['Content-Type', 'text/csv']]);
  });

  it('graphql: sends a JSON payload with only the query when there are no variables', () => {
    const r = resolveRequest(req({ method: 'POST', bodyType: 'graphql', body: 'query { me { id } }' }), []);
    expect(JSON.parse(textOf(r.request.body))).toEqual({ query: 'query { me { id } }' });
    expect(r.request.headers).toEqual([['Content-Type', 'application/json']]);
    expect(r.warnings).toEqual([]);
  });

  it('graphql: includes parsed, interpolated variables', () => {
    const r = resolveRequest(
      req({ method: 'POST', bodyType: 'graphql', body: 'query($id: ID!) { user(id: $id) { name } }', graphqlVariables: '{"id": "{{userId}}"}' }),
      vars({ userId: 'u-7' }),
    );
    expect(JSON.parse(textOf(r.request.body))).toEqual({ query: 'query($id: ID!) { user(id: $id) { name } }', variables: { id: 'u-7' } });
  });

  it('graphql: leaves out invalid variables JSON with a warning', () => {
    const r = resolveRequest(req({ method: 'POST', bodyType: 'graphql', body: '{ a }', graphqlVariables: '{id: 1' }), []);
    expect(JSON.parse(textOf(r.request.body))).toEqual({ query: '{ a }' });
    expect(r.warnings).toEqual(['GraphQL variables are not valid JSON, so they were left out.']);
  });

  it('graphql: ignores whitespace-only variables', () => {
    const r = resolveRequest(req({ method: 'POST', bodyType: 'graphql', body: '{ a }', graphqlVariables: '   ' }), []);
    expect(JSON.parse(textOf(r.request.body))).toEqual({ query: '{ a }' });
    expect(r.warnings).toEqual([]);
  });

  it('form: urlencoded fields skip disabled rows and empty keys, and are interpolated', () => {
    const r = resolveRequest(
      req({
        method: 'POST',
        bodyType: 'form',
        formFields: [kv('user', '{{u}}'), kv('off', 'x', false), kv('', 'no key'), kv('empty', '')],
      }),
      vars({ u: 'ada' }),
    );
    expect(r.request.body).toEqual({ kind: 'urlencoded', fields: [['user', 'ada'], ['empty', '']] });
    expect(r.request.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']]);
  });

  it('form: no formFields gives an empty field list', () => {
    const r = resolveRequest(req({ method: 'POST', bodyType: 'form' }), []);
    expect(r.request.body).toEqual({ kind: 'urlencoded', fields: [] });
  });

  it('multipart: text and file fields, no Content-Type header (the encoder picks the boundary)', () => {
    const fields: MultipartField[] = [
      { key: 'title', value: '{{t}}', enabled: true, kind: 'text' },
      { key: 'avatar', value: '', enabled: true, kind: 'file', file },
      { key: 'skipped', value: 'x', enabled: false, kind: 'text' },
      { key: '', value: 'no key', enabled: true, kind: 'text' },
    ];
    const r = resolveRequest(req({ method: 'POST', bodyType: 'multipart', multipartFields: fields }), vars({ t: 'Hi' }));
    expect(r.request.body).toEqual({ kind: 'multipart', fields: [{ name: 'title', value: 'Hi' }, { name: 'avatar', file }] });
    expect(findHeader(r.request.headers, 'content-type')).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('multipart: warns about a file field with no file and leaves it out', () => {
    const r = resolveRequest(
      req({ method: 'POST', bodyType: 'multipart', multipartFields: [{ key: 'avatar', value: '', enabled: true, kind: 'file' }] }),
      [],
    );
    expect(r.request.body).toEqual({ kind: 'multipart', fields: [] });
    expect(r.warnings).toEqual(['No file is chosen for the "avatar" field, so it will not be sent.']);
  });

  it('multipart: warns about a hand-set Content-Type', () => {
    const r = resolveRequest(
      req({
        method: 'POST',
        bodyType: 'multipart',
        headers: [kv('Content-Type', 'multipart/form-data')],
        multipartFields: [{ key: 'a', value: 'b', enabled: true, kind: 'text' }],
      }),
      [],
    );
    expect(r.warnings).toEqual(['A Content-Type header set by hand replaces the multipart boundary the browser would add.']);
    expect(r.request.headers).toEqual([['Content-Type', 'multipart/form-data']]);
  });

  it('binary: sends the file with its type as Content-Type', () => {
    const r = resolveRequest(req({ method: 'PUT', bodyType: 'binary', binaryFile: file }), []);
    expect(r.request.body).toEqual({ kind: 'binary', file });
    expect(r.request.headers).toEqual([['Content-Type', 'image/png']]);
  });

  it('binary: falls back to application/octet-stream when the file has no type', () => {
    const r = resolveRequest(req({ method: 'PUT', bodyType: 'binary', binaryFile: { ...file, type: '' } }), []);
    expect(r.request.headers).toEqual([['Content-Type', 'application/octet-stream']]);
  });

  it('binary: warns and sends no body without a file', () => {
    const r = resolveRequest(req({ method: 'PUT', bodyType: 'binary' }), []);
    expect(r.request.body).toEqual({ kind: 'none' });
    expect(r.request.headers).toEqual([]);
    expect(r.warnings).toEqual(['No file is chosen for the binary body, so no body will be sent.']);
  });

  it('none: no body and no Content-Type', () => {
    const r = resolveRequest(req({ method: 'POST', bodyType: 'none', body: 'ignored' }), []);
    expect(r.request.body).toEqual({ kind: 'none' });
    expect(r.request.headers).toEqual([]);
  });

  it.each(['GET', 'HEAD'] as const)('%s with a body warns and drops the body and its Content-Type', method => {
    const r = resolveRequest(req({ method, bodyType: 'json', body: '{"a":1}' }), []);
    expect(r.request.body).toEqual({ kind: 'none' });
    expect(r.request.headers).toEqual([]);
    expect(r.warnings).toEqual([`${method} requests cannot carry a body in the browser, so the body will not be sent.`]);
  });

  it('GET with bodyType none does not warn', () => {
    expect(resolveRequest(req({ method: 'GET' }), []).warnings).toEqual([]);
  });

  it('DELETE and OPTIONS may carry a body', () => {
    expect(resolveRequest(req({ method: 'DELETE', bodyType: 'text', body: 'x' }), []).request.body).toEqual({ kind: 'text', text: 'x' });
    expect(resolveRequest(req({ method: 'OPTIONS', bodyType: 'text', body: 'x' }), []).request.body).toEqual({ kind: 'text', text: 'x' });
  });
});

describe('encodeUrlencoded', () => {
  it('encodes spaces as + and unicode as UTF-8 percent-escapes', () => {
    expect(encodeUrlencoded([['q', 'hello world'], ['name', 'jösé']])).toBe('q=hello+world&name=j%C3%B6s%C3%A9');
  });

  it('escapes &, = and + in names and values', () => {
    expect(encodeUrlencoded([['a&b', 'c=d+e']])).toBe('a%26b=c%3Dd%2Be');
  });

  it('keeps repeated names and empty values', () => {
    expect(encodeUrlencoded([['tag', 'a'], ['tag', 'b'], ['empty', '']])).toBe('tag=a&tag=b&empty=');
  });

  it('returns an empty string for no fields', () => {
    expect(encodeUrlencoded([])).toBe('');
  });
});

describe('isForbiddenHeader', () => {
  it.each(['Host', 'host', 'Origin', 'Cookie', 'Referer', 'Content-Length', 'Connection', ' Host ', 'Sec-Fetch-Mode', 'sec-ch-ua', 'Proxy-Authorization', 'proxy-anything'])(
    '%s is forbidden',
    name => {
      expect(isForbiddenHeader(name)).toBe(true);
    },
  );

  it.each(['Authorization', 'Content-Type', 'Accept', 'X-Custom', 'User-Agent', 'Secret', 'Proxied'])('%s is allowed', name => {
    expect(isForbiddenHeader(name)).toBe(false);
  });
});

describe('isValidHeaderName', () => {
  it.each(['X-Custom-Header', 'content-type', "x!#$%&'*+.^_`|~0-9", 'A'])('%s is valid', name => {
    expect(isValidHeaderName(name)).toBe(true);
  });

  it.each(['', 'X Custom', 'X:Y', 'Ümlaut', 'a\nb', 'x(y)', 'x"y', 'x,y', 'x/y'])('%j is invalid', name => {
    expect(isValidHeaderName(name)).toBe(false);
  });
});

describe('methodAllowsBody', () => {
  it('disallows GET and HEAD only', () => {
    expect(methodAllowsBody('GET')).toBe(false);
    expect(methodAllowsBody('HEAD')).toBe(false);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(methodAllowsBody(m)).toBe(true);
  });
});

describe('findHeader', () => {
  const headers: Array<[string, string]> = [['Content-Type', 'application/json'], ['X-Rep', 'one'], ['x-rep', 'two']];

  it('matches case-insensitively', () => {
    expect(findHeader(headers, 'content-type')).toBe('application/json');
    expect(findHeader(headers, 'CONTENT-TYPE')).toBe('application/json');
  });

  it('returns the first match', () => {
    expect(findHeader(headers, 'X-REP')).toBe('one');
  });

  it('returns undefined when absent, and an empty string value when present but empty', () => {
    expect(findHeader(headers, 'Accept')).toBeUndefined();
    expect(findHeader([['Accept', '']], 'accept')).toBe('');
  });
});
