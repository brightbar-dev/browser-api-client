import { describe, it, expect } from 'vitest';
import {
  buildUrl, parseUrl, buildHeaders, formatSize, formatTime,
  statusColor, generateId, newRequest, isJsonContentType, prettyJson,
} from '../utils/request';

describe('buildUrl', () => {
  it('returns base URL with no params', () => {
    expect(buildUrl('https://api.example.com', [])).toBe('https://api.example.com');
  });

  it('appends enabled params', () => {
    const url = buildUrl('https://api.example.com/search', [
      { key: 'q', value: 'test', enabled: true },
      { key: 'page', value: '1', enabled: true },
    ]);
    expect(url).toBe('https://api.example.com/search?q=test&page=1');
  });

  it('skips disabled params', () => {
    const url = buildUrl('https://api.example.com', [
      { key: 'q', value: 'test', enabled: true },
      { key: 'skip', value: 'me', enabled: false },
    ]);
    expect(url).toContain('q=test');
    expect(url).not.toContain('skip');
  });

  it('skips empty keys', () => {
    const url = buildUrl('https://api.example.com', [
      { key: '', value: 'val', enabled: true },
    ]);
    expect(url).toBe('https://api.example.com');
  });

  it('adds https if missing', () => {
    const url = buildUrl('api.example.com', [
      { key: 'q', value: 'test', enabled: true },
    ]);
    expect(url.startsWith('https://')).toBe(true);
  });
});

describe('parseUrl', () => {
  it('extracts params from URL', () => {
    const { base, params } = parseUrl('https://api.example.com?q=test&page=1');
    expect(base).toBe('https://api.example.com/');
    expect(params).toHaveLength(2);
    expect(params[0]).toEqual({ key: 'q', value: 'test', enabled: true });
  });

  it('handles URL without params', () => {
    const { params } = parseUrl('https://api.example.com');
    expect(params).toHaveLength(0);
  });
});

describe('buildHeaders', () => {
  it('builds from key-value pairs', () => {
    const headers = buildHeaders(
      [{ key: 'Accept', value: 'application/json', enabled: true }],
      { type: 'none' }
    );
    expect(headers).toEqual({ Accept: 'application/json' });
  });

  it('adds bearer token', () => {
    const headers = buildHeaders([], { type: 'bearer', token: 'abc123' });
    expect(headers['Authorization']).toBe('Bearer abc123');
  });

  it('adds basic auth', () => {
    const headers = buildHeaders([], { type: 'basic', username: 'user', password: 'pass' });
    expect(headers['Authorization'].startsWith('Basic ')).toBe(true);
    expect(atob(headers['Authorization'].replace('Basic ', ''))).toBe('user:pass');
  });

  it('adds api key', () => {
    const headers = buildHeaders([], {
      type: 'api-key', headerName: 'X-API-Key', headerValue: 'secret',
    });
    expect(headers['X-API-Key']).toBe('secret');
  });

  it('skips disabled headers', () => {
    const headers = buildHeaders(
      [{ key: 'Skip', value: 'me', enabled: false }],
      { type: 'none' }
    );
    expect(headers).toEqual({});
  });
});

describe('formatSize', () => {
  it('formats bytes', () => expect(formatSize(500)).toBe('500 B'));
  it('formats KB', () => expect(formatSize(2048)).toBe('2.0 KB'));
  it('formats MB', () => expect(formatSize(1500000)).toBe('1.4 MB'));
  it('handles zero', () => expect(formatSize(0)).toBe('0 B'));
});

describe('formatTime', () => {
  it('formats milliseconds', () => expect(formatTime(150)).toBe('150 ms'));
  it('formats seconds', () => expect(formatTime(2500)).toBe('2.50 s'));
});

describe('statusColor', () => {
  it('success for 2xx', () => expect(statusColor(200)).toBe('success'));
  it('redirect for 3xx', () => expect(statusColor(301)).toBe('redirect'));
  it('client-error for 4xx', () => expect(statusColor(404)).toBe('client-error'));
  it('server-error for 5xx', () => expect(statusColor(500)).toBe('server-error'));
  it('info for 1xx', () => expect(statusColor(100)).toBe('info'));
});

describe('generateId', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, generateId));
    expect(ids.size).toBe(100);
  });
});

describe('newRequest', () => {
  it('creates with defaults', () => {
    const req = newRequest();
    expect(req.method).toBe('GET');
    expect(req.url).toBe('');
    expect(req.bodyType).toBe('none');
  });

  it('accepts custom name', () => {
    expect(newRequest('My Request').name).toBe('My Request');
  });
});

describe('isJsonContentType', () => {
  it('detects application/json', () => expect(isJsonContentType('application/json')).toBe(true));
  it('detects json charset', () => expect(isJsonContentType('application/json; charset=utf-8')).toBe(true));
  it('rejects text/html', () => expect(isJsonContentType('text/html')).toBe(false));
});

describe('prettyJson', () => {
  it('formats valid JSON', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('returns original for invalid JSON', () => {
    expect(prettyJson('not json')).toBe('not json');
  });
});
