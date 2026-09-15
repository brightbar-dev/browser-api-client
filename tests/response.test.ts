import { describe, it, expect } from 'vitest';
import {
  parseContentType, looksBinary, classifyBody, isTextualKind, decodeText, hexDump, findMatches,
  downloadFileName, headersToRecord, toHistoryResponse, describeFetchError, HISTORY_BODY_LIMIT,
} from '../utils/response';
import type { HistoryResponseInput } from '../utils/response';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('parseContentType', () => {
  it('splits mime and charset', () => {
    expect(parseContentType('application/json; charset=UTF-8')).toEqual({ mime: 'application/json', charset: 'UTF-8' });
  });

  it('lower-cases the mime and returns a null charset when absent', () => {
    expect(parseContentType('Text/HTML')).toEqual({ mime: 'text/html', charset: null });
  });

  it('finds charset among other params and strips quotes', () => {
    expect(parseContentType('text/plain; format=flowed; CHARSET="iso-8859-1"')).toEqual({ mime: 'text/plain', charset: 'iso-8859-1' });
  });

  it('handles empty input and an empty charset', () => {
    expect(parseContentType('')).toEqual({ mime: '', charset: null });
    expect(parseContentType('text/plain; charset=')).toEqual({ mime: 'text/plain', charset: null });
  });
});

describe('looksBinary', () => {
  it('is false for empty input', () => {
    expect(looksBinary(new Uint8Array())).toBe(false);
  });

  it('is false for ordinary text with tabs and newlines', () => {
    expect(looksBinary(bytes('hello\tworld\r\nline two\n'))).toBe(false);
  });

  it('is false for UTF-8 text', () => {
    expect(looksBinary(bytes('héllo wörld — ✓'))).toBe(false);
  });

  it('is true as soon as a NUL byte appears', () => {
    expect(looksBinary(new Uint8Array([0x68, 0x69, 0x00, 0x68]))).toBe(true);
  });

  it('is true when more than 10% of bytes are control characters', () => {
    const arr = new Uint8Array(100).fill(0x61);
    for (let i = 0; i < 11; i++) arr[i] = 0x01;
    expect(looksBinary(arr)).toBe(true);
  });

  it('tolerates a few control characters', () => {
    const arr = new Uint8Array(100).fill(0x61);
    for (let i = 0; i < 5; i++) arr[i] = 0x1b;
    expect(looksBinary(arr)).toBe(false);
  });

  it('only inspects the first 1024 bytes', () => {
    const arr = new Uint8Array(2048).fill(0x61);
    arr[1500] = 0;
    expect(looksBinary(arr)).toBe(false);
  });
});

describe('classifyBody', () => {
  it('returns empty for no bytes, whatever the type', () => {
    expect(classifyBody('application/json', new Uint8Array())).toBe('empty');
    expect(classifyBody('image/png', new Uint8Array())).toBe('empty');
  });

  it.each(['application/json', 'application/json; charset=utf-8', 'application/problem+json', 'application/vnd.api+json', 'text/json'])(
    '%s is json',
    type => {
      expect(classifyBody(type, bytes('{"a":1}'))).toBe('json');
    },
  );

  it('trusts a json content type even when the body does not parse', () => {
    expect(classifyBody('application/json', bytes('not json'))).toBe('json');
  });

  it('detects JSON sent as text/plain or with no type', () => {
    expect(classifyBody('text/plain', bytes('{"ok": true}'))).toBe('json');
    expect(classifyBody('', bytes('  \n[1, 2, 3]'))).toBe('json');
  });

  it('detects JSON after a UTF-8 BOM', () => {
    expect(classifyBody('text/plain', new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('{"a":1}')]))).toBe('json');
  });

  it('keeps text that only looks like JSON as text', () => {
    expect(classifyBody('text/plain', bytes('{not json'))).toBe('text');
    expect(classifyBody('', bytes('[INFO] started'))).toBe('text');
  });

  it('classifies html', () => {
    expect(classifyBody('text/html; charset=utf-8', bytes('<!doctype html><p>hi'))).toBe('html');
    expect(classifyBody('application/xhtml+xml', bytes('<html/>'))).toBe('html');
  });

  it('classifies xml including +xml types', () => {
    expect(classifyBody('application/xml', bytes('<a/>'))).toBe('xml');
    expect(classifyBody('text/xml', bytes('<a/>'))).toBe('xml');
    expect(classifyBody('application/atom+xml', bytes('<feed/>'))).toBe('xml');
  });

  it('classifies svg as an image, not xml', () => {
    expect(classifyBody('image/svg+xml', bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image');
  });

  it('classifies png as an image', () => {
    expect(classifyBody('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBe('image');
  });

  it('classifies application/octet-stream and pdf as binary even when the bytes are text', () => {
    expect(classifyBody('application/octet-stream', bytes('plain words'))).toBe('binary');
    expect(classifyBody('application/pdf', bytes('%PDF-1.7'))).toBe('binary');
  });

  it('classifies NUL bytes as binary even under a textual or missing type', () => {
    expect(classifyBody('text/plain', new Uint8Array([0x41, 0x00, 0x42]))).toBe('binary');
    expect(classifyBody('', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBe('binary');
  });

  it('classifies other textual types as text', () => {
    expect(classifyBody('text/csv', bytes('a,b\n1,2'))).toBe('text');
    expect(classifyBody('application/javascript', bytes('console.log(1)'))).toBe('text');
    expect(classifyBody('application/x-yaml', bytes('a: 1'))).toBe('text');
  });

  it('classifies an unknown non-application type with text bytes as text', () => {
    expect(classifyBody('foo/bar', bytes('hello'))).toBe('text');
  });
});

describe('isTextualKind', () => {
  it('is true for json, html, xml and text only', () => {
    expect(['json', 'html', 'xml', 'text'].every(k => isTextualKind(k as 'json'))).toBe(true);
    expect(isTextualKind('image')).toBe(false);
    expect(isTextualKind('binary')).toBe(false);
    expect(isTextualKind('empty')).toBe(false);
  });
});

describe('decodeText', () => {
  const latin1Cafe = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);

  it('decodes with the given latin-1 charset', () => {
    expect(decodeText(latin1Cafe, 'ISO-8859-1')).toBe('café');
    expect(decodeText(latin1Cafe, 'latin1')).toBe('café');
  });

  it('defaults to UTF-8', () => {
    expect(decodeText(bytes('café'), null)).toBe('café');
    expect(decodeText(latin1Cafe, null)).toBe('caf�');
  });

  it('falls back to UTF-8 for a bogus charset instead of throwing', () => {
    expect(decodeText(bytes('café ✓'), 'not-a-real-charset')).toBe('café ✓');
  });
});

describe('hexDump', () => {
  it('formats offset, padded hex and printable ASCII', () => {
    expect(hexDump(bytes('Hello, world!\n'))).toBe(
      '00000000  48 65 6c 6c 6f 2c 20 77 6f 72 6c 64 21 0a' + ' '.repeat(8) + '|Hello, world!.|',
    );
  });

  it('writes a full 16-byte row without padding', () => {
    expect(hexDump(bytes('ABCDEFGHIJKLMNOP'))).toBe('00000000  41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 50  |ABCDEFGHIJKLMNOP|');
  });

  it('starts a new row every 16 bytes with a hex offset', () => {
    const data = Uint8Array.from({ length: 20 }, (_, i) => i);
    const lines = hexDump(data).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('00000000  00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f  |................|');
    expect(lines[1]).toBe('00000010  10 11 12 13' + ' '.repeat(38) + '|....|');
  });

  it('shows bytes 0x7f and above as dots', () => {
    expect(hexDump(new Uint8Array([0x7e, 0x7f, 0x80, 0xff]))).toMatch(/\|~\.\.\.\|$/);
  });

  it('truncates at maxBytes with a "more bytes" line', () => {
    const lines = hexDump(new Uint8Array(600)).split('\n');
    expect(lines).toHaveLength(33);
    expect(lines[31]!.startsWith('000001f0  ')).toBe(true);
    expect(lines[32]).toBe('… 88 more bytes');
  });

  it('honours a custom maxBytes', () => {
    const lines = hexDump(new Uint8Array(40), 16).split('\n');
    expect(lines).toEqual(['00000000  00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00  |................|', '… 24 more bytes']);
  });

  it('adds no truncation line when everything fits', () => {
    expect(hexDump(new Uint8Array(512))).not.toContain('more bytes');
  });

  it('returns an empty string for no bytes', () => {
    expect(hexDump(new Uint8Array())).toBe('');
  });
});

describe('findMatches', () => {
  const text = 'Hello hello HELLO';

  it('is case-insensitive by default', () => {
    expect(findMatches(text, 'hello')).toEqual([[0, 5], [6, 11], [12, 17]]);
  });

  it('can be case-sensitive', () => {
    expect(findMatches(text, 'hello', true)).toEqual([[6, 11]]);
    expect(findMatches(text, 'HELLO', true)).toEqual([[12, 17]]);
  });

  it('stops at the limit', () => {
    expect(findMatches(text, 'hello', false, 2)).toEqual([[0, 5], [6, 11]]);
  });

  it('returns nothing for an empty query or no match', () => {
    expect(findMatches(text, '')).toEqual([]);
    expect(findMatches(text, 'bye')).toEqual([]);
  });

  it('does not return overlapping matches', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([[0, 2], [2, 4]]);
  });

  it('returns offsets into the original text even when lower-casing changes string length', () => {
    // 'İ'.toLowerCase() is two UTF-16 code units, which shifts every later offset.
    const t = 'İx abc';
    const matches = findMatches(t, 'abc');
    expect(matches).toEqual([[3, 6]]);
    expect(t.slice(matches[0]![0], matches[0]![1])).toBe('abc');
  });
});

describe('downloadFileName', () => {
  it('uses the last path segment plus an extension from the type', () => {
    expect(downloadFileName('https://api.example.com/users/42', 'application/json; charset=utf-8')).toBe('42.json');
  });

  it('keeps an existing extension', () => {
    expect(downloadFileName('https://cdn.example.com/files/report.pdf?dl=1', 'application/octet-stream')).toBe('report.pdf');
  });

  it('falls back to "response" for a root path or an invalid URL', () => {
    expect(downloadFileName('https://api.example.com/', 'text/html')).toBe('response.html');
    expect(downloadFileName('not a url', 'image/png')).toBe('response.png');
  });

  it('maps +json to json and unknown types to bin', () => {
    expect(downloadFileName('https://x.com/problem', 'application/problem+json')).toBe('problem.json');
    expect(downloadFileName('https://x.com/data', 'application/x-unknown')).toBe('data.bin');
    expect(downloadFileName('https://x.com/data', '')).toBe('data.bin');
  });

  it('decodes the segment and replaces unsafe characters, including an encoded slash', () => {
    expect(downloadFileName('https://x.com/my%20report', 'text/csv')).toBe('my_report.csv');
    expect(downloadFileName('https://x.com/a%2F..%2Fb', 'text/plain')).toBe('a_.._b.txt');
  });

  it('survives a malformed percent-escape', () => {
    expect(downloadFileName('https://x.com/bad%E0%A4%A', 'text/plain')).toBe('response.txt');
  });
});

describe('headersToRecord', () => {
  it('builds a record', () => {
    expect(headersToRecord([['content-type', 'text/plain'], ['x-id', '1']])).toEqual({ 'content-type': 'text/plain', 'x-id': '1' });
  });

  it('merges repeated headers with ", "', () => {
    expect(headersToRecord([['set-cookie', 'a=1'], ['vary', 'Accept'], ['set-cookie', 'b=2'], ['set-cookie', 'c=3']])).toEqual({
      'set-cookie': 'a=1, b=2, c=3',
      vary: 'Accept',
    });
  });

  it('returns an empty record for no headers', () => {
    expect(headersToRecord([])).toEqual({});
  });

  it('does not treat Object.prototype names as already-present headers', () => {
    const out = headersToRecord([['constructor', 'x']]);
    expect(out['constructor']).toBe('x');
  });
});

describe('toHistoryResponse', () => {
  const base: HistoryResponseInput = {
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'application/json'], ['x-a', '1'], ['x-a', '2']],
    size: 1234,
    time: 123.6,
    contentType: 'application/json',
    kind: 'json',
    text: '{"a":1}',
  };

  it('copies the summary, merges headers and rounds the time', () => {
    expect(toHistoryResponse(base)).toEqual({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json', 'x-a': '1, 2' },
      body: '{"a":1}',
      size: 1234,
      time: 124,
      contentType: 'application/json',
    });
  });

  it('cuts textual bodies at HISTORY_BODY_LIMIT', () => {
    const text = 'x'.repeat(HISTORY_BODY_LIMIT + 100);
    const body = toHistoryResponse({ ...base, kind: 'text', text }).body;
    expect(body.length).toBe(HISTORY_BODY_LIMIT);
    expect(HISTORY_BODY_LIMIT).toBe(64 * 1024);
  });

  it('keeps a body exactly at the limit', () => {
    const text = 'y'.repeat(HISTORY_BODY_LIMIT);
    expect(toHistoryResponse({ ...base, kind: 'html', text }).body).toBe(text);
  });

  it('omits binary and image bodies even when text is provided', () => {
    expect(toHistoryResponse({ ...base, kind: 'binary', text: 'garbage' }).body).toBe('');
    expect(toHistoryResponse({ ...base, kind: 'image', text: '<svg/>' }).body).toBe('');
  });

  it('stores an empty body when there is no text', () => {
    expect(toHistoryResponse({ ...base, kind: 'empty', text: undefined }).body).toBe('');
    expect(toHistoryResponse({ ...base, text: undefined }).body).toBe('');
  });

  it('keeps size as reported, not the stored body length', () => {
    expect(toHistoryResponse({ ...base, kind: 'binary', size: 999999 }).size).toBe(999999);
  });
});

describe('describeFetchError', () => {
  it('explains a timeout in seconds', () => {
    const f = describeFetchError(new Error('aborted'), { timedOut: true, timeoutMs: 30000, url: 'https://x.com' });
    expect(f.title).toBe('Request timed out');
    expect(f.detail).toContain('within 30 s');
  });

  it('prefers timed out over cancelled', () => {
    expect(describeFetchError(null, { timedOut: true, cancelled: true, timeoutMs: 5000, url: 'https://x.com' }).title).toBe('Request timed out');
  });

  it('explains a cancellation', () => {
    expect(describeFetchError(new DOMException('aborted', 'AbortError'), { cancelled: true, url: 'https://x.com' })).toEqual({
      title: 'Request cancelled',
      detail: 'You cancelled the request before a response arrived.',
    });
  });

  it('turns "Failed to fetch" into Could not connect, naming the host and port', () => {
    const f = describeFetchError(new TypeError('Failed to fetch'), { url: 'https://api.example.com:8443/users?x=1' });
    expect(f.title).toBe('Could not connect');
    expect(f.detail).toMatch(/^No response from api\.example\.com:8443\./);
  });

  it('recognises the Firefox and Safari network error wording', () => {
    expect(describeFetchError(new TypeError('NetworkError when attempting to fetch resource.'), { url: 'https://x.com/' }).title).toBe('Could not connect');
    expect(describeFetchError(new TypeError('Load failed'), { url: 'https://x.com/' }).title).toBe('Could not connect');
  });

  it('names the raw URL when it cannot be parsed', () => {
    expect(describeFetchError(new TypeError('Failed to fetch'), { url: 'weird url' }).detail).toMatch(/^No response from weird url\./);
  });

  it('passes other error messages through', () => {
    expect(describeFetchError(new TypeError("Failed to execute 'fetch': Invalid name"), { url: 'https://x.com' })).toEqual({
      title: 'Request failed',
      detail: "Failed to execute 'fetch': Invalid name",
    });
  });

  it('stringifies non-Error rejections', () => {
    expect(describeFetchError('boom', { url: 'https://x.com' })).toEqual({ title: 'Request failed', detail: 'boom' });
  });
});
