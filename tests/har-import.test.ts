import { describe, it, expect } from 'vitest';
import { importHar } from '../utils/har-import';
import type { ApiRequest } from '../utils/request';

const h = (name: string, value: string) => ({ name, value });

const har = {
  log: {
    version: '1.2',
    creator: { name: 'WebInspector', version: '537.36' },
    pages: [],
    entries: [
      {
        startedDateTime: '2026-09-14T10:00:00.000Z',
        request: {
          method: 'GET',
          url: 'https://api.example.com/v1/users?page=2&q=a%20b',
          httpVersion: 'http/2.0',
          headers: [
            h(':authority', 'api.example.com'),
            h(':method', 'GET'),
            h(':path', '/v1/users?page=2&q=a%20b'),
            h(':scheme', 'https'),
            h('accept', 'application/json'),
            h('authorization', 'Bearer tok-123'),
            h('cookie', 'sid=abc'),
            h('x-request-id', 'r-1'),
          ],
          queryString: [{ name: 'page', value: '2' }, { name: 'q', value: 'a b' }],
          cookies: [{ name: 'sid', value: 'abc' }],
          headersSize: -1,
          bodySize: 0,
        },
        response: { status: 200 },
      },
      {
        request: {
          method: 'POST',
          url: 'http://localhost:3000/api/items',
          httpVersion: 'HTTP/1.1',
          headers: [
            h('Host', 'localhost:3000'),
            h('Connection', 'keep-alive'),
            h('Keep-Alive', 'timeout=5'),
            h('Content-Length', '27'),
            h('Content-Type', 'application/json;charset=UTF-8'),
            h('Cookie', 'a=1'),
          ],
          postData: { mimeType: 'application/json;charset=UTF-8', text: '{"name":"Lamp","qty":2}' },
        },
      },
      {
        request: {
          method: 'POST',
          url: 'https://e.com/login',
          headers: [h('content-type', 'application/x-www-form-urlencoded')],
          postData: {
            mimeType: 'application/x-www-form-urlencoded',
            text: 'user=ken&note=two+words%21',
            params: [{ name: 'user', value: 'ken' }, { name: 'note', value: 'two+words%21' }],
          },
        },
      },
      {
        request: {
          method: 'POST',
          url: 'https://e.com/upload',
          headers: [h('content-type', 'multipart/form-data; boundary=----WebKitFormBoundaryX')],
          postData: {
            mimeType: 'multipart/form-data; boundary=----WebKitFormBoundaryX',
            text: '------WebKitFormBoundaryX\r\nContent-Disposition: form-data; name="title"\r\n\r\nHoliday\r\n------WebKitFormBoundaryX\r\nContent-Disposition: form-data; name="photo"; filename="beach.jpg"\r\nContent-Type: image/jpeg\r\n\r\n\r\n------WebKitFormBoundaryX--\r\n',
          },
        },
      },
      {
        request: {
          method: 'POST',
          url: 'https://e.com/upload2',
          headers: [h('Content-Type', 'multipart/form-data; boundary=---------------------------1234')],
          postData: {
            mimeType: 'multipart/form-data; boundary=---------------------------1234',
            params: [
              { name: 'title', value: 'Firefox' },
              { name: 'doc', fileName: 'report.pdf', contentType: 'application/pdf' },
            ],
          },
        },
      },
      { request: { method: 'GET', url: 'data:image/png;base64,iVBORw0KGgo=', headers: [] } },
      { request: { method: 'GET', url: 'chrome-extension://abc/icon.png', headers: [] } },
      { request: { method: 'CONNECT', url: 'https://e.com:443', headers: [] } },
      {
        request: {
          method: 'PUT',
          url: 'https://e.com/notes/1',
          headers: [h('Content-Type', 'text/plain')],
          postData: { mimeType: 'text/plain', text: 'hello' },
        },
      },
      {
        request: {
          method: 'POST',
          url: 'https://e.com/soap',
          headers: [],
          postData: { mimeType: 'application/xml', text: '<a/>' },
        },
      },
      {
        request: {
          method: 'POST',
          url: 'https://e.com/empty',
          headers: [h('Content-Type', 'application/json')],
          postData: { mimeType: 'application/json', text: '' },
        },
      },
      null,
      { response: {} },
    ],
  },
};

describe('importHar', () => {
  const { value: requests, warnings } = importHar(JSON.stringify(har));
  const byUrl = (url: string): ApiRequest => {
    const r = requests.find(x => x.url === url);
    if (!r) throw new Error(`missing ${url}`);
    return r;
  };

  it('imports every http(s) entry with a supported method, in order', () => {
    expect(requests.map(r => r.name)).toEqual([
      'GET api.example.com/v1/users',
      'POST localhost:3000/api/items',
      'POST e.com/login',
      'POST e.com/upload',
      'POST e.com/upload2',
      'PUT e.com/notes/1',
      'POST e.com/soap',
      'POST e.com/empty',
    ]);
  });

  it('keeps the recorded URL with its query and mirrors it raw in params', () => {
    const r = byUrl('https://api.example.com/v1/users?page=2&q=a%20b');
    expect(r.method).toBe('GET');
    expect(r.params).toEqual([
      { key: 'page', value: '2', enabled: true },
      { key: 'q', value: 'a%20b', enabled: true },
    ]);
  });

  it('drops pseudo-headers and cookies, and turns a bearer header into auth', () => {
    const r = byUrl('https://api.example.com/v1/users?page=2&q=a%20b');
    expect(r.headers).toEqual([
      { key: 'accept', value: 'application/json', enabled: true },
      { key: 'x-request-id', value: 'r-1', enabled: true },
    ]);
    expect(r.auth).toEqual({ type: 'bearer', token: 'tok-123' });
    expect(r.bodyType).toBe('none');
  });

  it('drops hop-by-hop, Host and Content-Length headers; keeps a JSON Content-Type with parameters', () => {
    const r = byUrl('http://localhost:3000/api/items');
    expect(r.headers).toEqual([{ key: 'Content-Type', value: 'application/json;charset=UTF-8', enabled: true }]);
    expect(r.bodyType).toBe('json');
    expect(r.body).toBe('{"name":"Lamp","qty":2}');
  });

  it('decodes an urlencoded body from its text into form fields', () => {
    const r = byUrl('https://e.com/login');
    expect(r.bodyType).toBe('form');
    expect(r.formFields).toEqual([
      { key: 'user', value: 'ken', enabled: true },
      { key: 'note', value: 'two words!', enabled: true },
    ]);
    expect(r.headers).toEqual([]);
  });

  it('splits a captured multipart body; file parts become file fields', () => {
    const r = byUrl('https://e.com/upload');
    expect(r.bodyType).toBe('multipart');
    expect(r.multipartFields).toEqual([
      { key: 'title', value: 'Holiday', enabled: true, kind: 'text' },
      { key: 'photo', value: 'beach.jpg', enabled: true, kind: 'file' },
    ]);
    expect(r.headers).toEqual([]);
  });

  it('uses postData.params for multipart when there is no text', () => {
    const r = byUrl('https://e.com/upload2');
    expect(r.bodyType).toBe('multipart');
    expect(r.multipartFields).toEqual([
      { key: 'title', value: 'Firefox', enabled: true, kind: 'text' },
      { key: 'doc', value: 'report.pdf', enabled: true, kind: 'file' },
    ]);
    expect(r.headers).toEqual([]);
  });

  it('types text bodies from the header or the postData mimeType', () => {
    expect(byUrl('https://e.com/notes/1')).toMatchObject({ bodyType: 'text', textContentType: 'text/plain', body: 'hello', headers: [] });
    expect(byUrl('https://e.com/soap')).toMatchObject({ bodyType: 'text', textContentType: 'application/xml', body: '<a/>' });
  });

  it('an empty JSON body keeps its type', () => {
    expect(byUrl('https://e.com/empty')).toMatchObject({ bodyType: 'json', body: '', headers: [] });
  });

  it('warns about skipped entries, file fields and cookies', () => {
    expect(warnings).toContain('Skipped 2 entries that are not http or https.');
    expect(warnings).toContain('Skipped requests with unsupported methods: CONNECT.');
    expect(warnings.filter(w => w.includes('Attach it again'))).toHaveLength(2);
    expect(warnings.some(w => w.startsWith('Browser cookies were not imported (2 requests)'))).toBe(true);
  });

  it('throws on invalid JSON and on JSON that is not a HAR', () => {
    expect(() => importHar('{')).toThrow(/not valid JSON/);
    expect(() => importHar('{"log": {}}')).toThrow(/not a HAR file/);
    expect(() => importHar('[]')).toThrow(/not a HAR file/);
  });

  it('returns no requests with a warning for an empty log', () => {
    const { value, warnings: w } = importHar('{"log": {"entries": []}}');
    expect(value).toEqual([]);
    expect(w).toEqual(['The HAR file has no requests.']);
  });
});
