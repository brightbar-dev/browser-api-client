import { describe, it, expect } from 'vitest';
import { toCurl, toFetch, toPython } from '../utils/export';
import type { ApiRequest } from '../utils/request';

const baseRequest: ApiRequest = {
  id: 'test',
  name: 'Test',
  method: 'GET',
  url: 'https://api.example.com/users',
  headers: [],
  params: [],
  body: '',
  bodyType: 'none',
  auth: { type: 'none' },
};

describe('toCurl', () => {
  it('generates basic GET', () => {
    const curl = toCurl(baseRequest);
    expect(curl).toContain('curl -X GET');
    expect(curl).toContain('https://api.example.com/users');
  });

  it('includes auth header', () => {
    const req: ApiRequest = { ...baseRequest, auth: { type: 'bearer', token: 'abc' } };
    const curl = toCurl(req);
    expect(curl).toContain('Authorization: Bearer abc');
  });

  it('includes body for POST', () => {
    const req: ApiRequest = {
      ...baseRequest, method: 'POST',
      body: '{"name":"test"}', bodyType: 'json',
    };
    const curl = toCurl(req);
    expect(curl).toContain('-X POST');
    expect(curl).toContain('-d');
    expect(curl).toContain('Content-Type: application/json');
  });

  it('includes custom headers', () => {
    const req: ApiRequest = {
      ...baseRequest,
      headers: [{ key: 'X-Custom', value: 'value', enabled: true }],
    };
    const curl = toCurl(req);
    expect(curl).toContain('X-Custom: value');
  });
});

describe('toFetch', () => {
  it('generates basic GET', () => {
    const code = toFetch(baseRequest);
    expect(code).toContain("fetch('https://api.example.com/users'");
    expect(code).toContain("method: 'GET'");
  });

  it('includes headers', () => {
    const req: ApiRequest = {
      ...baseRequest,
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    };
    const code = toFetch(req);
    expect(code).toContain('Accept');
    expect(code).toContain('application/json');
  });

  it('includes JSON body', () => {
    const req: ApiRequest = {
      ...baseRequest, method: 'POST',
      body: '{"test": true}', bodyType: 'json',
    };
    const code = toFetch(req);
    expect(code).toContain('JSON.stringify');
  });
});

describe('toPython', () => {
  it('generates basic GET', () => {
    const code = toPython(baseRequest);
    expect(code).toContain('import requests');
    expect(code).toContain('requests.get');
  });

  it('includes auth header', () => {
    const req: ApiRequest = {
      ...baseRequest,
      auth: { type: 'bearer', token: 'tok' },
    };
    const code = toPython(req);
    expect(code).toContain('headers=headers');
    expect(code).toContain('Authorization');
  });
});
