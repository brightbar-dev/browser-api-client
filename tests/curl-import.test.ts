import { describe, it, expect } from 'vitest';
import {
  parseCurl,
  queryParamsFromUrl,
  appendQuery,
  requestNameFromUrl,
  authFromHeaders,
} from '../utils/curl-import';

const header = (headers: Array<{ key: string; value: string }>, name: string) =>
  headers.find(h => h.key.toLowerCase() === name.toLowerCase())?.value;

describe('parseCurl — Chrome DevTools "Copy as cURL (bash)"', () => {
  const chrome = String.raw`curl 'https://api.example.com/v2/orders?page=2&sort=-created_at' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: en-GB,en;q=0.9' \
  -H 'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig' \
  -H 'content-type: application/json' \
  -b 'sid=abc123; theme=dark' \
  -H 'origin: https://app.example.com' \
  -H 'priority: u=1, i' \
  -H 'referer: https://app.example.com/orders' \
  -H 'sec-ch-ua: "Chromium";v="128", "Not;A=Brand";v="24"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-fetch-mode: cors' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' \
  --data-raw $'{"customer":"O\'Brien","note":"said \\"hi\\"\\nthen left","tags":["a","b"]}'`;

  const { value: r, warnings } = parseCurl(chrome);

  it('defaults to POST because there is data', () => {
    expect(r.method).toBe('POST');
  });

  it('keeps the query in the URL and mirrors it in params', () => {
    expect(r.url).toBe('https://api.example.com/v2/orders?page=2&sort=-created_at');
    expect(r.params).toEqual([
      { key: 'page', value: '2', enabled: true },
      { key: 'sort', value: '-created_at', enabled: true },
    ]);
  });

  it('names the request METHOD host/path', () => {
    expect(r.name).toBe('POST api.example.com/v2/orders');
  });

  it('turns the bearer header into auth and removes it', () => {
    expect(r.auth).toEqual({ type: 'bearer', token: 'eyJhbGciOiJIUzI1NiJ9.e30.sig' });
    expect(header(r.headers, 'authorization')).toBeUndefined();
  });

  it('decodes the $\'…\' JSON body exactly, including escaped quotes', () => {
    expect(r.bodyType).toBe('json');
    expect(r.body).toBe(String.raw`{"customer":"O'Brien","note":"said \"hi\"\nthen left","tags":["a","b"]}`);
    expect(JSON.parse(r.body).note).toBe('said "hi"\nthen left');
  });

  it('drops the Content-Type the JSON body implies and keeps the rest in order', () => {
    expect(header(r.headers, 'content-type')).toBeUndefined();
    expect(r.headers.map(h => h.key)).toEqual([
      'accept', 'accept-language', 'origin', 'priority', 'referer', 'sec-ch-ua',
      'sec-ch-ua-mobile', 'sec-fetch-mode', 'user-agent', 'Cookie',
    ]);
    expect(header(r.headers, 'sec-ch-ua')).toBe('"Chromium";v="128", "Not;A=Brand";v="24"');
    expect(header(r.headers, 'Cookie')).toBe('sid=abc123; theme=dark');
  });

  it('has no warnings', () => {
    expect(warnings).toEqual([]);
  });
});

describe('parseCurl — Chrome DevTools "Copy as cURL (cmd)"', () => {
  const cmd = [
    String.raw`curl ^"https://api.example.com/items?a=1^&b=2^" ^`,
    String.raw`  -H ^"accept: */*^" ^`,
    String.raw`  -H ^"content-type: application/json^" ^`,
    String.raw`  --data-raw ^"^{^\^"name^\^":^\^"x y^\^",^\^"path^\^":^\^"C:^\^\^\^\tmp^\^"^}^" ^`,
    '  --compressed',
  ].join('\r\n');

  it('undoes caret escaping, line continuations and doubled backslashes', () => {
    const { value: r, warnings } = parseCurl(cmd);
    expect(r.url).toBe('https://api.example.com/items?a=1&b=2');
    expect(r.method).toBe('POST');
    expect(header(r.headers, 'accept')).toBe('*/*');
    expect(r.bodyType).toBe('json');
    expect(r.body).toBe(String.raw`{"name":"x y","path":"C:\\tmp"}`);
    expect(JSON.parse(r.body).path).toBe('C:\\tmp');
    expect(warnings).toEqual([]);
  });

  it('keeps newlines encoded as ^ followed by two line breaks', () => {
    const { value: r } = parseCurl('curl ^"https://x.test/^" --data-raw ^"line1^\n\nline2^"');
    expect(r.body).toBe('line1\nline2');
    expect(r.bodyType).toBe('text');
  });

  it('reads plain cmd-style double quotes', () => {
    const { value: r } = parseCurl('curl "https://x.test/a" -H "X-Test: 1" -d "{\\"a\\":1}"');
    expect(r.url).toBe('https://x.test/a');
    expect(header(r.headers, 'X-Test')).toBe('1');
    expect(r.body).toBe('{"a":1}');
    expect(r.bodyType).toBe('json');
  });
});

describe('parseCurl — tokenizing', () => {
  it('ignores a leading "$ " prompt and handles combined short flags', () => {
    const { value: r, warnings } = parseCurl("$ curl -sSLk -XPUT 'https://example.com/things/1'");
    expect(r.method).toBe('PUT');
    expect(r.url).toBe('https://example.com/things/1');
    expect(warnings).toEqual([]);
  });

  it('handles -sX PUT with the value in the next token', () => {
    expect(parseCurl('curl -sX PATCH https://example.com').value.method).toBe('PATCH');
  });

  it('accepts --option=value forms', () => {
    const { value: r } = parseCurl("curl --request=DELETE --header='X-Id: 7' https://example.com/x");
    expect(r.method).toBe('DELETE');
    expect(header(r.headers, 'X-Id')).toBe('7');
  });

  it('joins backslash-newline continuations and reads double-quote escapes', () => {
    const cmd = 'curl \\\n  -H "X-Quote: say \\"hi\\" \\\\ back" \\\n  https://example.com';
    const { value: r } = parseCurl(cmd);
    expect(header(r.headers, 'X-Quote')).toBe('say "hi" \\ back');
    expect(r.url).toBe('https://example.com');
  });

  it('turns $VAR and ${VAR} into {{variables}} outside single quotes, with a warning', () => {
    const cmd = 'curl -H "Authorization: Bearer $API_TOKEN" "https://${HOST}/v1/me" -H \'X-Literal: $NOT\'';
    const { value: r, warnings } = parseCurl(cmd);
    expect(r.auth).toEqual({ type: 'bearer', token: '{{API_TOKEN}}' });
    expect(r.url).toBe('https://{{HOST}}/v1/me');
    expect(header(r.headers, 'X-Literal')).toBe('$NOT');
    expect(warnings.some(w => w.includes('API_TOKEN') && w.includes('HOST'))).toBe(true);
  });

  it('decodes ANSI-C escapes: \\t, \\x, \\u, octal and UTF-8 byte sequences', () => {
    const { value: r } = parseCurl("curl https://x.test --data-raw $'a\\tb\\x41\\u00e9\\101\\xc3\\xa9\\u0021'");
    expect(r.body).toBe('a\tbAéAé!');
  });

  it('stops at a pipe and says so', () => {
    const { value: r, warnings } = parseCurl("curl -s https://example.com/data | jq '.items'");
    expect(r.url).toBe('https://example.com/data');
    expect(warnings.some(w => w.includes('jq'))).toBe(true);
  });

  it('accepts a command without the leading curl', () => {
    expect(parseCurl('-X POST https://example.com -d a=1').value.method).toBe('POST');
    expect(parseCurl('https://example.com/ping').value.url).toBe('https://example.com/ping');
  });

  it('warns about an unclosed quote instead of throwing', () => {
    const { value: r, warnings } = parseCurl("curl https://example.com -d '{\"a\":1");
    expect(r.body).toBe('{"a":1');
    expect(warnings.some(w => w.includes('unclosed quote'))).toBe(true);
  });

  it('accepts curl.exe', () => {
    expect(parseCurl('curl.exe https://example.com').value.url).toBe('https://example.com');
  });
});

describe('parseCurl — errors', () => {
  it('throws for text that is not a curl command', () => {
    expect(() => parseCurl('wget https://example.com')).toThrow(/not a curl command/);
    expect(() => parseCurl('hello there')).toThrow(/not a curl command/);
  });

  it('throws when there is no URL', () => {
    expect(() => parseCurl("curl -H 'Accept: */*'")).toThrow(/No URL/);
  });

  it('throws on empty input', () => {
    expect(() => parseCurl('   ')).toThrow(/Paste a curl command/);
  });
});

describe('parseCurl — options', () => {
  it('defaults to GET without data', () => {
    const { value: r } = parseCurl('curl https://example.com/');
    expect(r.method).toBe('GET');
    expect(r.name).toBe('GET example.com');
    expect(r.bodyType).toBe('none');
    expect(r.headers).toEqual([]);
  });

  it('silently ignores no-op options, including ones that take values', () => {
    const { warnings } = parseCurl(
      "curl -s -S -L -k -v -i --compressed --location --insecure -o out.json -w '%{http_code}' --connect-timeout 5 --max-time 30 --retry 2 --http2 --no-progress-meter https://example.com",
    );
    expect(warnings).toEqual([]);
  });

  it('warns about unknown options without crashing', () => {
    const { value: r, warnings } = parseCurl('curl --frobnicate -Wq https://example.com');
    expect(r.url).toBe('https://example.com');
    expect(warnings.join(' ')).toContain('--frobnicate');
    expect(warnings.join(' ')).toContain('-W');
  });

  it('joins multiple -d with & and makes form fields from a=1&b=2 data', () => {
    const { value: r } = parseCurl("curl https://example.com/login -d 'user=ken' -d 'note=two%20words+here&empty='");
    expect(r.method).toBe('POST');
    expect(r.bodyType).toBe('form');
    expect(r.formFields).toEqual([
      { key: 'user', value: 'ken', enabled: true },
      { key: 'note', value: 'two words here', enabled: true },
      { key: 'empty', value: '', enabled: true },
    ]);
  });

  it('drops the default urlencoded Content-Type for form bodies', () => {
    const { value: r } = parseCurl("curl https://e.com -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1'");
    expect(r.bodyType).toBe('form');
    expect(header(r.headers, 'content-type')).toBeUndefined();
  });

  it('reads --data-urlencode forms', () => {
    const { value: r } = parseCurl("curl https://e.com --data-urlencode 'q=hello world & more' --data-urlencode 'email=a@b.com'");
    expect(r.bodyType).toBe('form');
    expect(r.formFields).toEqual([
      { key: 'q', value: 'hello world & more', enabled: true },
      { key: 'email', value: 'a@b.com', enabled: true },
    ]);
  });

  it('-G moves data into the query', () => {
    const { value: r } = parseCurl("curl -G 'https://e.com/search?lang=en' --data-urlencode 'q=hello world' -d limit=5");
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://e.com/search?lang=en&q=hello%20world&limit=5');
    expect(r.params.map(p => p.key)).toEqual(['lang', 'q', 'limit']);
    expect(r.params[1]?.value).toBe('hello%20world');
    expect(r.bodyType).toBe('none');
  });

  it('warns about -d @file and leaves the body empty', () => {
    const { value: r, warnings } = parseCurl("curl -X POST https://e.com -H 'Content-Type: application/json' -d @payload.json");
    expect(r.method).toBe('POST');
    expect(r.body).toBe('');
    expect(r.bodyType).toBe('json');
    expect(warnings.join(' ')).toContain('payload.json');
  });

  it('-d @file without a content type leaves the body type none', () => {
    const { value: r } = parseCurl('curl https://e.com --data-binary @dump.bin');
    expect(r.method).toBe('POST');
    expect(r.bodyType).toBe('none');
  });

  it('--data-raw keeps a leading @ literally', () => {
    const { value: r } = parseCurl("curl https://e.com --data-raw '@handle'");
    expect(r.body).toBe('@handle');
    expect(r.bodyType).toBe('text');
  });

  it('--json sets a JSON body and an Accept header', () => {
    const { value: r } = parseCurl(`curl --json '{"a":1}' https://e.com/items`);
    expect(r.method).toBe('POST');
    expect(r.bodyType).toBe('json');
    expect(r.body).toBe('{"a":1}');
    expect(header(r.headers, 'accept')).toBe('application/json');
    expect(header(r.headers, 'content-type')).toBeUndefined();
  });

  it('keeps a JSON Content-Type the body type does not imply', () => {
    const { value: r } = parseCurl(`curl https://e.com -H 'Content-Type: application/vnd.api+json' -d '{"data":{}}'`);
    expect(r.bodyType).toBe('json');
    expect(header(r.headers, 'content-type')).toBe('application/vnd.api+json');
  });

  it('detects a JSON body without a content type', () => {
    const { value: r } = parseCurl(`curl https://e.com -d '[1,2,3]'`);
    expect(r.bodyType).toBe('json');
  });

  it('uses the Content-Type header as textContentType for other bodies', () => {
    const { value: r } = parseCurl("curl https://e.com -H 'Content-Type: application/xml; charset=utf-8' -d '<a>1</a>'");
    expect(r.bodyType).toBe('text');
    expect(r.textContentType).toBe('application/xml; charset=utf-8');
    expect(r.body).toBe('<a>1</a>');
    expect(header(r.headers, 'content-type')).toBeUndefined();
  });

  it('defaults a plain body to text/plain', () => {
    const { value: r } = parseCurl("curl https://e.com -d 'just some words'");
    expect(r.bodyType).toBe('text');
    expect(r.textContentType).toBe('text/plain');
  });

  it('reads -F text and file fields, with ;type= and a re-attach warning', () => {
    const { value: r, warnings } = parseCurl(
      "curl https://e.com/upload -H 'Content-Type: multipart/form-data' -F 'name=Ken' -F 'avatar=@/tmp/photos/me.png;type=image/png' -F 'doc=@report.pdf;filename=q3.pdf' -F 'note=a;b' --form-string 'raw=@not-a-file'",
    );
    expect(r.method).toBe('POST');
    expect(r.bodyType).toBe('multipart');
    expect(r.multipartFields).toEqual([
      { key: 'name', value: 'Ken', enabled: true, kind: 'text' },
      { key: 'avatar', value: 'me.png', enabled: true, kind: 'file' },
      { key: 'doc', value: 'q3.pdf', enabled: true, kind: 'file' },
      { key: 'note', value: 'a;b', enabled: true, kind: 'text' },
      { key: 'raw', value: '@not-a-file', enabled: true, kind: 'text' },
    ]);
    expect(r.multipartFields?.[1]?.file).toBeUndefined();
    expect(header(r.headers, 'content-type')).toBeUndefined();
    expect(warnings.filter(w => w.includes('Attach it again'))).toHaveLength(2);
  });

  it('strips ;type= from a text -F value', () => {
    const { value: r } = parseCurl(`curl https://e.com -F 'meta={"a":1};type=application/json'`);
    expect(r.multipartFields).toEqual([{ key: 'meta', value: '{"a":1}', enabled: true, kind: 'text' }]);
  });

  it('parses a multipart body captured with --data-raw', () => {
    const body = "$'------B\\r\\nContent-Disposition: form-data; name=\"title\"\\r\\n\\r\\nHello\\r\\n------B\\r\\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\\r\\nContent-Type: image/png\\r\\n\\r\\n\\r\\n------B--\\r\\n'";
    const { value: r, warnings } = parseCurl(`curl https://e.com -H 'content-type: multipart/form-data; boundary=----B' --data-raw ${body}`);
    expect(r.bodyType).toBe('multipart');
    expect(r.multipartFields).toEqual([
      { key: 'title', value: 'Hello', enabled: true, kind: 'text' },
      { key: 'file', value: 'a.png', enabled: true, kind: 'file' },
    ]);
    expect(header(r.headers, 'content-type')).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('-u user:pass becomes basic auth', () => {
    const { value: r } = parseCurl('curl -u ken:s3cr:et https://e.com');
    expect(r.auth).toEqual({ type: 'basic', username: 'ken', password: 's3cr:et' });
  });

  it('decodes an Authorization: Basic header into basic auth', () => {
    const { value: r } = parseCurl("curl https://e.com -H 'Authorization: Basic a2VuOnBhc3M='");
    expect(r.auth).toEqual({ type: 'basic', username: 'ken', password: 'pass' });
    expect(r.headers).toEqual([]);
  });

  it('leaves other Authorization schemes as headers', () => {
    const { value: r } = parseCurl("curl https://e.com -H 'Authorization: Token abc'");
    expect(r.auth.type).toBe('none');
    expect(header(r.headers, 'Authorization')).toBe('Token abc');
  });

  it('--oauth2-bearer becomes bearer auth', () => {
    expect(parseCurl('curl --oauth2-bearer tok https://e.com').value.auth).toEqual({ type: 'bearer', token: 'tok' });
  });

  it('warns that --digest is imported as basic', () => {
    const { value: r, warnings } = parseCurl('curl --digest -u a:b https://e.com');
    expect(r.auth.type).toBe('basic');
    expect(warnings.join(' ')).toContain('digest');
  });

  it('-A, -e and -b become headers; a cookie file warns', () => {
    const { value: r, warnings } = parseCurl("curl -A 'MyAgent/1.0' -e https://ref.example -b 'a=1' -b 'b=2' -b jar.txt https://e.com");
    expect(header(r.headers, 'User-Agent')).toBe('MyAgent/1.0');
    expect(header(r.headers, 'Referer')).toBe('https://ref.example');
    expect(header(r.headers, 'Cookie')).toBe('a=1; b=2');
    expect(warnings.join(' ')).toContain('jar.txt');
  });

  it('-H with a trailing ; sends an empty header, -H "Name:" imports nothing', () => {
    const { value: r } = parseCurl("curl https://e.com -H 'X-Empty;' -H 'Accept:'");
    expect(r.headers).toEqual([{ key: 'X-Empty', value: '', enabled: true }]);
  });

  it('-I makes HEAD, and an explicit -X wins', () => {
    expect(parseCurl('curl -I https://e.com').value.method).toBe('HEAD');
    expect(parseCurl('curl -I -X GET https://e.com').value.method).toBe('GET');
  });

  it('lowercase -X methods are accepted; unsupported ones warn', () => {
    expect(parseCurl('curl -X post https://e.com').value.method).toBe('POST');
    const { value: r, warnings } = parseCurl('curl -X PROPFIND https://e.com');
    expect(r.method).toBe('GET');
    expect(warnings.join(' ')).toContain('PROPFIND');
  });

  it('--url sets the URL; extra URLs warn', () => {
    const { value: r, warnings } = parseCurl('curl --url https://one.example/a https://two.example/b');
    expect(r.url).toBe('https://one.example/a');
    expect(warnings.join(' ')).toContain('two.example');
  });

  it('--url-query appends to the query', () => {
    const { value: r } = parseCurl("curl https://e.com/x --url-query 'q=a b' --url-query '+raw=%2F'");
    expect(r.url).toBe('https://e.com/x?q=a%20b&raw=%2F');
  });

  it('-T becomes a binary body without a file, with a warning', () => {
    const { value: r, warnings } = parseCurl('curl -T ./image.png https://e.com/upload');
    expect(r.method).toBe('PUT');
    expect(r.bodyType).toBe('binary');
    expect(r.binaryFile).toBeUndefined();
    expect(warnings.join(' ')).toContain('image.png');
  });

  it('warns about options that cannot be carried over', () => {
    const { warnings } = parseCurl('curl -x http://proxy:8080 https://e.com');
    expect(warnings.join(' ')).toContain('--proxy');
  });
});

describe('shared helpers', () => {
  it('queryParamsFromUrl splits on & then the first =, keeping values raw', () => {
    expect(queryParamsFromUrl('https://e.com/p?a=1&b=x%20y&flag&c=d=e&&#frag=1')).toEqual([
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: 'x%20y', enabled: true },
      { key: 'flag', value: '', enabled: true },
      { key: 'c', value: 'd=e', enabled: true },
    ]);
    expect(queryParamsFromUrl('https://e.com/p')).toEqual([]);
  });

  it('appendQuery respects existing ? & and #fragment', () => {
    expect(appendQuery('https://e.com/p', 'a=1')).toBe('https://e.com/p?a=1');
    expect(appendQuery('https://e.com/p?x=1', 'a=1')).toBe('https://e.com/p?x=1&a=1');
    expect(appendQuery('https://e.com/p?', 'a=1')).toBe('https://e.com/p?a=1');
    expect(appendQuery('https://e.com/p#top', 'a=1')).toBe('https://e.com/p?a=1#top');
  });

  it('requestNameFromUrl drops scheme, userinfo, query and fragment', () => {
    expect(requestNameFromUrl('GET', 'https://user:pw@api.e.com:8443/v1/x?y=1#z')).toBe('GET api.e.com:8443/v1/x');
    expect(requestNameFromUrl('POST', '{{baseUrl}}/pets')).toBe('POST {{baseUrl}}/pets');
    expect(requestNameFromUrl('GET', '')).toBe('GET');
  });

  it('authFromHeaders ignores disabled and undecodable headers', () => {
    const disabled = [{ key: 'Authorization', value: 'Bearer x', enabled: false }];
    expect(authFromHeaders(disabled).auth).toBeNull();
    const bad = [{ key: 'Authorization', value: 'Basic !!!', enabled: true }];
    expect(authFromHeaders(bad)).toEqual({ headers: bad, auth: null });
  });
});
