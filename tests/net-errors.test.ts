import { describe, it, expect } from 'vitest';
import { classifyNetError, describeNetError } from '../utils/net-errors';

describe('classifyNetError', () => {
  it.each([
    ['net::ERR_NAME_NOT_RESOLVED', 'dns'],
    ['NS_ERROR_UNKNOWN_HOST', 'dns'],
    ['net::ERR_CONNECTION_REFUSED', 'refused'],
    ['NS_ERROR_CONNECTION_REFUSED', 'refused'],
    ['net::ERR_CONNECTION_TIMED_OUT', 'timeout'],
    ['NS_ERROR_NET_TIMEOUT', 'timeout'],
    ['net::ERR_CERT_AUTHORITY_INVALID', 'tls'],
    ['net::ERR_SSL_PROTOCOL_ERROR', 'tls'],
    ['SEC_ERROR_UNKNOWN_ISSUER', 'tls'],
    ['net::ERR_INTERNET_DISCONNECTED', 'offline'],
    ['net::ERR_BLOCKED_BY_CLIENT', 'blocked'],
    ['net::ERR_CONNECTION_RESET', 'reset'],
    ['net::ERR_EMPTY_RESPONSE', 'reset'],
    ['net::ERR_TOO_MANY_REDIRECTS', 'redirects'],
    ['net::ERR_UNSAFE_PORT', 'unsafe-port'],
    ['net::ERR_HTTP2_PROTOCOL_ERROR', 'protocol'],
    ['net::ERR_ABORTED', 'unknown'],
    ['net::ERR_SOMETHING_NEW', 'unknown'],
  ])('%s → %s', (code, kind) => {
    expect(classifyNetError(code)).toBe(kind);
  });
});

describe('describeNetError', () => {
  it('names the host and gives a next step', () => {
    const info = describeNetError('net::ERR_NAME_NOT_RESOLVED', 'api.example.invalid');
    expect(info.title).toBe('Host not found');
    expect(info.detail).toContain('api.example.invalid');
    expect(info.detail).toContain('DNS');
  });

  it('mentions the raw code for errors it does not know', () => {
    const info = describeNetError('net::ERR_SOMETHING_NEW', 'h');
    expect(info.kind).toBe('unknown');
    expect(info.detail).toContain('net::ERR_SOMETHING_NEW');
  });

  it('falls back to "the server" without a host', () => {
    expect(describeNetError('net::ERR_CONNECTION_REFUSED', '').detail).toContain('the server');
  });
});
