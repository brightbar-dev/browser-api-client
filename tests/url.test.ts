import { describe, it, expect } from 'vitest';
import {
  splitUrl, parseQuery, paramsFromUrl, serializeQuery, urlWithParams,
  hasScheme, isLocalHost, impliedScheme, withDefaultScheme, toRequestUrl,
} from '../utils/url';
import type { KeyValuePair } from '../utils/request';

const on = (key: string, value = ''): KeyValuePair => ({ key, value, enabled: true });
const off = (key: string, value = ''): KeyValuePair => ({ key, value, enabled: false });

describe('splitUrl', () => {
  it('returns a null query when there is no ?', () => {
    expect(splitUrl('https://api.example.com/users')).toEqual({ base: 'https://api.example.com/users', query: null, hash: '' });
  });

  it('splits base, query and hash', () => {
    expect(splitUrl('https://x.com/p?a=1&b=2#section')).toEqual({ base: 'https://x.com/p', query: 'a=1&b=2', hash: '#section' });
  });

  it('distinguishes ? with no params (empty string) from no ?', () => {
    expect(splitUrl('https://x.com/p?').query).toBe('');
    expect(splitUrl('https://x.com/p').query).toBeNull();
  });

  it('treats a ? after # as part of the fragment', () => {
    expect(splitUrl('https://x.com/p#frag?notquery')).toEqual({ base: 'https://x.com/p', query: null, hash: '#frag?notquery' });
  });

  it('keeps {{vars}} intact', () => {
    expect(splitUrl('{{baseUrl}}/users?id={{id}}')).toEqual({ base: '{{baseUrl}}/users', query: 'id={{id}}', hash: '' });
  });

  it('splits at the first ? only', () => {
    expect(splitUrl('https://x.com/?a=what?b').query).toBe('a=what?b');
  });
});

describe('parseQuery', () => {
  it('parses key=value pairs as enabled params', () => {
    expect(parseQuery('a=1&b=2')).toEqual([on('a', '1'), on('b', '2')]);
  });

  it('treats key and key= the same (empty value)', () => {
    expect(parseQuery('flag')).toEqual([on('flag', '')]);
    expect(parseQuery('flag=')).toEqual([on('flag', '')]);
  });

  it('skips empty segments from a trailing or doubled &', () => {
    expect(parseQuery('a=1&')).toEqual([on('a', '1')]);
    expect(parseQuery('a=1&&b=2')).toEqual([on('a', '1'), on('b', '2')]);
    expect(parseQuery('')).toEqual([]);
  });

  it('splits at the first = only, so values may contain =', () => {
    expect(parseQuery('filter=a=b')).toEqual([on('filter', 'a=b')]);
  });

  it('keeps values exactly as typed (no decoding)', () => {
    expect(parseQuery('q=hello%20world&r=a+b&v={{token}}')).toEqual([
      on('q', 'hello%20world'), on('r', 'a+b'), on('v', '{{token}}'),
    ]);
  });

  it('allows an empty key', () => {
    expect(parseQuery('=x')).toEqual([on('', 'x')]);
  });
});

describe('paramsFromUrl', () => {
  it('returns the URL query as enabled params when there is no previous table', () => {
    expect(paramsFromUrl('https://x.com/?a=1&b=2')).toEqual([on('a', '1'), on('b', '2')]);
  });

  it('returns no params when the URL has no query', () => {
    expect(paramsFromUrl('https://x.com/')).toEqual([]);
  });

  it('keeps only the disabled rows when the query is removed', () => {
    const prev = [on('a', '1'), off('debug', 'true'), on('b', '2')];
    expect(paramsFromUrl('https://x.com/', prev)).toEqual([off('debug', 'true')]);
  });

  it('keeps disabled rows anchored among the enabled ones', () => {
    const prev = [on('a', '1'), off('x', 'hidden'), on('b', '2'), off('y')];
    const result = paramsFromUrl('https://x.com/?a=10&b=20&c=30', prev);
    expect(result).toEqual([on('a', '10'), off('x', 'hidden'), on('b', '20'), off('y'), on('c', '30')]);
  });

  it('drops enabled rows the URL no longer has', () => {
    const prev = [on('a', '1'), off('x'), on('b', '2')];
    expect(paramsFromUrl('https://x.com/?a=1', prev)).toEqual([on('a', '1'), off('x')]);
  });

  it('puts new params after disabled rows when there were no enabled rows before them', () => {
    const prev = [off('x')];
    expect(paramsFromUrl('https://x.com/?a=1', prev)).toEqual([off('x'), on('a', '1')]);
  });

  it('ignores the fragment', () => {
    expect(paramsFromUrl('https://x.com/?a=1#b=2')).toEqual([on('a', '1')]);
  });
});

describe('serializeQuery', () => {
  it('joins enabled params and omits disabled ones', () => {
    expect(serializeQuery([on('a', '1'), off('b', '2'), on('c', '3')])).toBe('a=1&c=3');
  });

  it('writes a key with an empty value as the bare key', () => {
    expect(serializeQuery([on('flag')])).toBe('flag');
  });

  it('skips rows with both key and value empty', () => {
    expect(serializeQuery([on(''), on('a', '1')])).toBe('a=1');
  });

  it('keeps a row with an empty key but a value', () => {
    expect(serializeQuery([on('', 'x')])).toBe('=x');
  });

  it('escapes & and # in values but leaves = alone', () => {
    expect(serializeQuery([on('q', 'a&b#c=d')])).toBe('q=a%26b%23c=d');
  });

  it('escapes &, # and = in keys', () => {
    expect(serializeQuery([on('a=b&c#d', '1')])).toBe('a%3Db%26c%23d=1');
  });

  it('leaves {{vars}} and other characters untouched', () => {
    expect(serializeQuery([on('token', '{{token}}'), on('q', 'hello world')])).toBe('token={{token}}&q=hello world');
  });

  it('returns an empty string for no params', () => {
    expect(serializeQuery([])).toBe('');
  });
});

describe('urlWithParams', () => {
  it('replaces the existing query with the table', () => {
    expect(urlWithParams('https://x.com/p?old=1', [on('new', '2')])).toBe('https://x.com/p?new=2');
  });

  it('preserves the #fragment after the query', () => {
    expect(urlWithParams('https://x.com/p?old=1#top', [on('q', '1')])).toBe('https://x.com/p?q=1#top');
  });

  it('removes the ? when there are no enabled params', () => {
    expect(urlWithParams('https://x.com/p?', [])).toBe('https://x.com/p');
    expect(urlWithParams('https://x.com/p?a=1#h', [off('a', '1')])).toBe('https://x.com/p#h');
  });

  it('keeps {{vars}} in base and params', () => {
    expect(urlWithParams('{{baseUrl}}/users', [on('token', '{{token}}')])).toBe('{{baseUrl}}/users?token={{token}}');
  });

  it('round-trips URL → params → URL with vars, fragment and raw encodings intact', () => {
    const url = '{{baseUrl}}/search?q={{term}}&page=2&name=a%20b&filter=x=y#results';
    expect(urlWithParams(url, paramsFromUrl(url))).toBe(url);
  });

  it('round-trips a table value containing & and # through the URL as escaped text', () => {
    const url = urlWithParams('https://x.com/', [on('q', 'a&b#c')]);
    expect(url).toBe('https://x.com/?q=a%26b%23c');
    // The URL owns raw text, so the table now shows the escaped form.
    expect(paramsFromUrl(url)).toEqual([on('q', 'a%26b%23c')]);
  });

  it('round-trips a table value containing = unchanged', () => {
    const url = urlWithParams('https://x.com/', [on('filter', 'a=b')]);
    expect(paramsFromUrl(url)).toEqual([on('filter', 'a=b')]);
  });

  it('drops a trailing & on round trip', () => {
    const url = 'https://x.com/?a=1&';
    expect(urlWithParams(url, paramsFromUrl(url))).toBe('https://x.com/?a=1');
  });

  it('normalizes key= to bare key on round trip (current behaviour)', () => {
    const url = 'https://x.com/?flag=&other';
    expect(urlWithParams(url, paramsFromUrl(url))).toBe('https://x.com/?flag&other');
  });

  it('keeps disabled params out of the URL but in the table', () => {
    const table = [on('a', '1'), off('debug', 'true'), on('b', '2')];
    const url = urlWithParams('https://x.com/', table);
    expect(url).toBe('https://x.com/?a=1&b=2');
    expect(paramsFromUrl(url, table)).toEqual(table);
  });
});

describe('hasScheme', () => {
  it('detects scheme://', () => {
    expect(hasScheme('https://x.com')).toBe(true);
    expect(hasScheme('HTTP://x.com')).toBe(true);
    expect(hasScheme('ftp://files.example.com')).toBe(true);
    expect(hasScheme('  http://x.com')).toBe(true);
    expect(hasScheme('git+ssh://host/repo')).toBe(true);
  });

  it('does not mistake host:port or variables for a scheme', () => {
    expect(hasScheme('localhost:3000/api')).toBe(false);
    expect(hasScheme('api.example.com')).toBe(false);
    expect(hasScheme('{{baseUrl}}/x')).toBe(false);
    expect(hasScheme('mailto:someone@example.com')).toBe(false);
    expect(hasScheme('')).toBe(false);
  });
});

describe('isLocalHost', () => {
  it.each([
    'localhost', 'LOCALHOST', 'localhost:8080', '127.0.0.1', '127.1.2.3:9000', '0.0.0.0', '[::1]', '[::1]:8080',
    '10.0.0.5', '10.255.255.255:443', '192.168.1.10', '172.16.0.1', '172.20.5.5', '172.31.255.255',
    'printer.local', 'app.localhost', 'site.test', 'svc.internal', 'NAS.LOCAL:5000',
  ])('%s is local', host => {
    expect(isLocalHost(host)).toBe(true);
  });

  it.each([
    'api.example.com', 'example.com:8080', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1',
    'localhost.example.com', 'local', 'mytest', '',
  ])('%s is not local', host => {
    expect(isLocalHost(host)).toBe(false);
  });
});

describe('impliedScheme', () => {
  it('returns null for empty input', () => {
    expect(impliedScheme('')).toBeNull();
    expect(impliedScheme('   ')).toBeNull();
  });

  it('returns null when a scheme is already present', () => {
    expect(impliedScheme('https://api.example.com')).toBeNull();
    expect(impliedScheme('http://localhost')).toBeNull();
    expect(impliedScheme('ftp://x.com')).toBeNull();
  });

  it('returns null when a variable leads the URL', () => {
    expect(impliedScheme('{{baseUrl}}/x')).toBeNull();
    expect(impliedScheme('  {{baseUrl}}/x')).toBeNull();
  });

  it('implies https for public hosts', () => {
    expect(impliedScheme('api.example.com/users')).toBe('https');
    expect(impliedScheme('example.com:8443')).toBe('https');
    expect(impliedScheme('8.8.8.8/dns')).toBe('https');
  });

  it('implies http for local and private hosts', () => {
    expect(impliedScheme('localhost:3000/api')).toBe('http');
    expect(impliedScheme('127.0.0.1:8080')).toBe('http');
    expect(impliedScheme('10.1.2.3/x')).toBe('http');
    expect(impliedScheme('192.168.0.1?x=1')).toBe('http');
    expect(impliedScheme('172.16.4.4#frag')).toBe('http');
    expect(impliedScheme('printer.local/status')).toBe('http');
  });

  it('reads the host after a leading //', () => {
    expect(impliedScheme('//localhost/x')).toBe('http');
    expect(impliedScheme('//api.example.com/x')).toBe('https');
  });
});

describe('withDefaultScheme', () => {
  it('prefixes https for public hosts', () => {
    expect(withDefaultScheme('api.example.com/x')).toBe('https://api.example.com/x');
  });

  it('prefixes http for local hosts and trims whitespace', () => {
    expect(withDefaultScheme('  localhost:3000 ')).toBe('http://localhost:3000');
  });

  it('replaces a leading // rather than doubling it', () => {
    expect(withDefaultScheme('//api.example.com/x')).toBe('https://api.example.com/x');
  });

  it('leaves URLs with a scheme or leading variable alone (trimmed)', () => {
    expect(withDefaultScheme(' https://a.com/x ')).toBe('https://a.com/x');
    expect(withDefaultScheme('{{baseUrl}}/x')).toBe('{{baseUrl}}/x');
  });

  it('returns an empty string for blank input', () => {
    expect(withDefaultScheme('   ')).toBe('');
  });
});

describe('toRequestUrl', () => {
  it('adds https and normalizes a public URL', () => {
    expect(toRequestUrl('api.example.com/users?q=1')).toBe('https://api.example.com/users?q=1');
  });

  it('adds http for localhost and a trailing slash for a bare host', () => {
    expect(toRequestUrl('localhost:8080')).toBe('http://localhost:8080/');
  });

  it('keeps an explicit http scheme for a public host', () => {
    expect(toRequestUrl('http://example.com/a')).toBe('http://example.com/a');
  });

  it('keeps the fragment', () => {
    expect(toRequestUrl('https://example.com/a#b')).toBe('https://example.com/a#b');
  });

  it('rejects an empty URL with a message', () => {
    expect(() => toRequestUrl('')).toThrow('Enter a URL to send the request to.');
    expect(() => toRequestUrl('   ')).toThrow('Enter a URL');
  });

  it('rejects ftp:// with a message naming the scheme', () => {
    expect(() => toRequestUrl('ftp://files.example.com/a.txt')).toThrow('Only http and https URLs can be sent (got ftp).');
  });

  it('rejects file:// too', () => {
    expect(() => toRequestUrl('file:///etc/passwd')).toThrow(/got file/);
  });

  it('rejects garbage as not a valid URL', () => {
    expect(() => toRequestUrl('http://')).toThrow('"http://" is not a valid URL.');
    expect(() => toRequestUrl('exa mple.com')).toThrow('is not a valid URL');
    expect(() => toRequestUrl('javascript:alert(1)')).toThrow();
  });

  it('rejects an uninterpolated leading variable', () => {
    expect(() => toRequestUrl('{{baseUrl}}/x')).toThrow('"{{baseUrl}}/x" is not a valid URL.');
  });

  it('throws Error instances whose message is fit to show', () => {
    try {
      toRequestUrl('ftp://x.com');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).not.toMatch(/TypeError|Invalid URL/);
    }
  });
});
