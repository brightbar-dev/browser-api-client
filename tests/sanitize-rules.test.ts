import { describe, it, expect } from 'vitest';
import { sanitizeAssertions, sanitizeExtractions, sanitizeRequest } from '../utils/sanitize';

describe('sanitize tests, variables and OAuth 2.0 config', () => {
  it('keeps valid assertions and drops unknown sources or operators', () => {
    const out = sanitizeAssertions([
      { id: 'a', enabled: false, source: 'jsonpath', path: '$.id', op: 'exists', expected: '' },
      { id: 'b', source: 'status', op: 'equals', expected: 200 },
      { id: 'c', source: 'script', op: 'equals', expected: 'x' },
      { id: 'd', source: 'status', op: 'eval', expected: 'x' },
      'nope',
    ]);
    expect(out).toEqual([
      { id: 'a', enabled: false, source: 'jsonpath', path: '$.id', op: 'exists', expected: '' },
      { id: 'b', enabled: true, source: 'status', path: '', op: 'equals', expected: '200' },
    ]);
  });

  it('keeps valid extractions and drops unknown sources', () => {
    const out = sanitizeExtractions([
      { id: 'x', enabled: true, source: 'header', path: 'X-Request-Id', variable: 'reqId' },
      { id: 'y', source: 'cookie', path: 'sid', variable: 'sid' },
    ]);
    expect(out).toEqual([{ id: 'x', enabled: true, source: 'header', path: 'X-Request-Id', variable: 'reqId' }]);
  });

  it('round-trips rules, sendCookies and OAuth 2.0 config on a request', () => {
    const req = sanitizeRequest({
      method: 'get',
      url: 'https://api.example.com',
      sendCookies: true,
      assertions: [{ id: 'a', enabled: true, source: 'time', path: '', op: 'lt', expected: '500' }],
      extractions: [{ id: 'x', enabled: true, source: 'jsonpath', path: '$.token', variable: 'token' }],
      auth: {
        type: 'oauth2',
        oauth2: { grant: 'authorization_code', authUrl: 'https://a/authorize', tokenUrl: 'https://a/token', clientId: 'c', clientSecret: '', scope: 'read', usePkce: true, clientAuth: 'body', accessToken: 'must-not-survive' },
      },
    })!;
    expect(req.sendCookies).toBe(true);
    expect(req.assertions).toHaveLength(1);
    expect(req.extractions).toHaveLength(1);
    expect(req.auth.type).toBe('oauth2');
    expect(req.auth.oauth2).toEqual({ grant: 'authorization_code', authUrl: 'https://a/authorize', tokenUrl: 'https://a/token', clientId: 'c', clientSecret: '', scope: 'read', usePkce: true, clientAuth: 'body' });
  });

  it('never keeps sendCookies unless it is literally true', () => {
    expect(sanitizeRequest({ url: 'x', sendCookies: 'yes' })!.sendCookies).toBeUndefined();
  });
});
