/**
 * Import a request from a curl command line.
 *
 * Handles what people actually paste: DevTools "Copy as cURL" for bash and for cmd,
 * docs snippets with backslash continuations and `$TOKEN` placeholders, and hand-typed
 * commands. Nothing is ever evaluated. Unknown options become warnings, never errors.
 *
 * The helpers in the first section are shared with the HAR, OpenAPI and Postman importers.
 */

import type { ApiRequest, AuthConfig, HttpMethod, KeyValuePair, MultipartField } from './request';
import { HTTP_METHODS, newRequest } from './request';

export interface ImportResult<T> {
  value: T;
  /** What could not be carried over, each fit to show the user. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Shared import helpers
// ---------------------------------------------------------------------------

/** Enabled params for a URL's query: segments split on `&`, then on the first `=`. Values stay raw. */
export function queryParamsFromUrl(url: string): KeyValuePair[] {
  const hash = url.indexOf('#');
  const rest = hash === -1 ? url : url.slice(0, hash);
  const q = rest.indexOf('?');
  if (q === -1) return [];
  const params: KeyValuePair[] = [];
  for (const segment of rest.slice(q + 1).split('&')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    params.push(
      eq === -1
        ? { key: segment, value: '', enabled: true }
        : { key: segment.slice(0, eq), value: segment.slice(eq + 1), enabled: true },
    );
  }
  return params;
}

/** Append a raw query string (no leading `?`) to a URL, keeping any `#fragment` last. */
export function appendQuery(url: string, query: string): string {
  if (!query) return url;
  const h = url.indexOf('#');
  const base = h === -1 ? url : url.slice(0, h);
  const hash = h === -1 ? '' : url.slice(h);
  const sep = !base.includes('?') ? '?' : base.endsWith('?') || base.endsWith('&') ? '' : '&';
  return `${base}${sep}${query}${hash}`;
}

/** `METHOD host/path`, the default name for an imported request. */
export function requestNameFromUrl(method: string, url: string): string {
  let rest = url.trim();
  const cut = rest.search(/[?#]/);
  if (cut !== -1) rest = rest.slice(0, cut);
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/\//, '');
  const slash = rest.indexOf('/');
  let authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '' : rest.slice(slash);
  const at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  const where = authority + (path === '/' ? '' : path);
  return where ? `${method} ${where}` : method;
}

/** The last header with this name (case-insensitive), or undefined. */
export function headerValue(headers: KeyValuePair[], name: string): string | undefined {
  const lower = name.toLowerCase();
  let found: string | undefined;
  for (const h of headers) if (h.key.toLowerCase() === lower) found = h.value;
  return found;
}

export function removeHeaders(headers: KeyValuePair[], name: string): KeyValuePair[] {
  const lower = name.toLowerCase();
  return headers.filter(h => h.key.toLowerCase() !== lower);
}

/** `application/json; charset=utf-8` → `application/json`. */
export function mediaTypeOf(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase();
}

export function isJsonMediaType(mediaType: string): boolean {
  return mediaType === 'application/json' || mediaType === 'text/json' || mediaType.endsWith('+json');
}

/** The warning for a file field whose bytes could not come along. */
export function reattachWarning(field: string): string {
  return `The file for the "${field}" field was not imported. Attach it again before sending.`;
}

/**
 * Turn an `Authorization: Bearer …` (or decodable `Basic …`) header into auth settings.
 * Returns the headers without it, or the headers unchanged and `auth: null`.
 */
export function authFromHeaders(headers: KeyValuePair[]): { headers: KeyValuePair[]; auth: AuthConfig | null } {
  const idx = headers.findIndex(h => h.enabled && h.key.toLowerCase() === 'authorization');
  const header = headers[idx];
  if (!header) return { headers, auth: null };
  const value = header.value.trim();
  let auth: AuthConfig | null = null;
  const bearer = /^bearer\s+(\S.*)$/i.exec(value);
  if (bearer?.[1]) {
    auth = { type: 'bearer', token: bearer[1].trim() };
  } else {
    const basic = /^basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(value);
    const decoded = basic?.[1] ? decodeBase64Utf8(basic[1]) : null;
    const colon = decoded ? decoded.indexOf(':') : -1;
    if (decoded && colon !== -1) {
      auth = { type: 'basic', username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
    }
  }
  if (!auth) return { headers, auth: null };
  return { headers: headers.filter((_, k) => k !== idx), auth };
}

function decodeBase64Utf8(b64: string): string | null {
  try {
    const bin = atob(b64);
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  if (!((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

const FORM_SEGMENT = /^[^=&\s]+(?:=[^&\s]*)?$/;

/** `a=1&b=two%20words`: every segment is `key` or `key=value`, with no whitespace. */
function looksLikeForm(text: string): boolean {
  return text.includes('=') && text.split('&').every(s => s === '' || FORM_SEGMENT.test(s));
}

function decodeFormComponent(s: string): string {
  const spaced = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** Decode an urlencoded body into form fields. */
export function formFieldsFromText(text: string): KeyValuePair[] {
  return text
    .split('&')
    .filter(s => s !== '')
    .map(seg => {
      const eq = seg.indexOf('=');
      return {
        key: decodeFormComponent(eq === -1 ? seg : seg.slice(0, eq)),
        value: eq === -1 ? '' : decodeFormComponent(seg.slice(eq + 1)),
        enabled: true,
      };
    });
}

/** Split a captured multipart/form-data body into fields. File parts become file fields without bytes. */
function parseMultipartText(text: string, boundary: string): MultipartField[] | null {
  if (!boundary) return null;
  const parts = text.split(`--${boundary}`);
  const fields: MultipartField[] = [];
  for (const raw of parts.slice(1)) {
    if (raw.startsWith('--')) break;
    const part = raw.replace(/^\r?\n/, '');
    const split = /\r?\n\r?\n/.exec(part);
    if (!split) continue;
    const head = part.slice(0, split.index);
    const content = part.slice(split.index + split[0].length).replace(/\r?\n$/, '');
    const disposition = head.split(/\r?\n/).find(l => /^content-disposition\s*:/i.test(l));
    if (!disposition) continue;
    const name = /;\s*name="([^"]*)"/i.exec(disposition)?.[1] ?? /;\s*name=([^;\s]+)/i.exec(disposition)?.[1];
    if (name === undefined) continue;
    const filename = /;\s*filename="([^"]*)"/i.exec(disposition)?.[1];
    fields.push(
      filename !== undefined
        ? { key: name, value: filename, enabled: true, kind: 'file' }
        : { key: name, value: content, enabled: true, kind: 'text' },
    );
  }
  return fields.length > 0 ? fields : null;
}

/**
 * Set a request's body from the raw text it was sent with and its Content-Type.
 *
 * JSON content types (or, with no content type, text that parses as a JSON object or
 * array) become `json`; urlencoded (or `a=1&b=2`-shaped text) becomes `form`; a captured
 * multipart body becomes `multipart`; anything else is `text` with `textContentType`.
 * A Content-Type header the chosen body type already implies is removed, so the sender's
 * own choice (and a multipart boundary) is not overridden. With no text and no content
 * type the body stays `none`.
 */
export function applyTextBody(req: ApiRequest, text: string, contentType: string | undefined, warnings: string[]): void {
  const ct = (contentType ?? '').trim();
  const mt = mediaTypeOf(ct);
  if (!mt && text === '') return;
  const dropContentType = () => {
    req.headers = removeHeaders(req.headers, 'content-type');
  };

  if (mt === 'multipart/form-data') {
    const b = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(ct);
    const fields = b ? parseMultipartText(text, b[1] ?? b[2] ?? '') : null;
    if (fields) {
      req.bodyType = 'multipart';
      req.body = '';
      req.multipartFields = fields;
      for (const f of fields) if (f.kind === 'file') warnings.push(reattachWarning(f.key));
      dropContentType();
      return;
    }
  }
  if (isJsonMediaType(mt) || (!mt && looksLikeJson(text))) {
    req.bodyType = 'json';
    req.body = text;
    if (ct.toLowerCase() === 'application/json') dropContentType();
    return;
  }
  if ((mt === 'application/x-www-form-urlencoded' && (text === '' || looksLikeForm(text))) || (!mt && looksLikeForm(text))) {
    req.bodyType = 'form';
    req.body = '';
    req.formFields = formFieldsFromText(text);
    if (ct.toLowerCase() === 'application/x-www-form-urlencoded') dropContentType();
    return;
  }
  req.bodyType = 'text';
  req.body = text;
  req.textContentType = ct || 'text/plain';
  dropContentType();
}

// ---------------------------------------------------------------------------
// Tokenizing
// ---------------------------------------------------------------------------

interface Tokenized {
  tokens: string[];
  /** Names of `$NAME` / `${NAME}` shell variables that became `{{NAME}}`. */
  shellVariables: string[];
  /** Text after a pipe, `;`, `&&` or redirect, which is not part of the curl command. */
  trailing: string;
}

const UNCLOSED_QUOTE = 'The command has an unclosed quote; the rest of it was read as one value.';

const ANSI_C_SIMPLE: Record<string, string> = {
  a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
  '\\': '\\', "'": "'", '"': '"', '?': '?',
};

/** Split a command the way a POSIX shell would, without expanding anything but `$NAME` → `{{NAME}}`. */
function tokenizePosix(src: string, warnings: string[]): Tokenized {
  const tokens: string[] = [];
  const vars = new Set<string>();
  const n = src.length;
  let cur = '';
  let inWord = false;
  let i = 0;

  /** Read `$NAME` or `${NAME}` at `pos`; returns the index after it, or -1. */
  const readVariable = (pos: number): number => {
    const re = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/y;
    re.lastIndex = pos;
    const m = re.exec(src);
    const name = m?.[1] ?? m?.[2];
    if (!m || !name) return -1;
    vars.add(name);
    cur += `{{${name}}}`;
    return pos + m[0].length;
  };

  /** Read the body of `$'…'` starting after the opening quote; returns the index after the closing quote. */
  const readAnsiC = (start: number): number => {
    let j = start;
    let bytes: number[] = [];
    const flush = () => {
      if (bytes.length > 0) cur += new TextDecoder().decode(new Uint8Array(bytes));
      bytes = [];
    };
    while (j < n) {
      const ch = src.charAt(j);
      if (ch === "'") {
        flush();
        return j + 1;
      }
      if (ch !== '\\') {
        flush();
        cur += ch;
        j++;
        continue;
      }
      const e = src.charAt(j + 1);
      j += 2;
      const simple = ANSI_C_SIMPLE[e];
      if (simple !== undefined) {
        flush();
        cur += simple;
      } else if (e === 'x') {
        const m = /^[0-9a-fA-F]{1,2}/.exec(src.slice(j, j + 2));
        if (m) {
          bytes.push(parseInt(m[0], 16));
          j += m[0].length;
        } else {
          flush();
          cur += '\\x';
        }
      } else if (e >= '0' && e <= '7') {
        const m = /^[0-7]{1,3}/.exec(src.slice(j - 1, j + 2));
        const digits = m?.[0] ?? e;
        bytes.push(parseInt(digits, 8) & 0xff);
        j += digits.length - 1;
      } else if (e === 'u' || e === 'U') {
        const max = e === 'u' ? 4 : 8;
        const m = new RegExp(`^[0-9a-fA-F]{1,${max}}`).exec(src.slice(j, j + max));
        flush();
        if (m) {
          const cp = parseInt(m[0], 16);
          if (cp <= 0x10ffff) cur += String.fromCodePoint(cp);
          j += m[0].length;
        } else {
          cur += `\\${e}`;
        }
      } else if (e === 'c' && j < n) {
        flush();
        cur += String.fromCharCode(src.charCodeAt(j) & 0x1f);
        j++;
      } else {
        flush();
        cur += `\\${e}`;
      }
    }
    flush();
    warnings.push(UNCLOSED_QUOTE);
    return n;
  };

  /** Read the body of `"…"` starting after the opening quote. */
  const readDouble = (start: number): number => {
    let j = start;
    while (j < n) {
      const ch = src.charAt(j);
      if (ch === '"') return j + 1;
      if (ch === '\\') {
        const e = src.charAt(j + 1);
        if (e === '\n') j += 2;
        else if (e === '\r' && src.charAt(j + 2) === '\n') j += 3;
        else if (e === '"' || e === '\\' || e === '$' || e === '`') {
          cur += e;
          j += 2;
        } else {
          cur += '\\';
          j++;
        }
        continue;
      }
      if (ch === '$') {
        const after = readVariable(j);
        if (after !== -1) {
          j = after;
          continue;
        }
      }
      cur += ch;
      j++;
    }
    warnings.push(UNCLOSED_QUOTE);
    return n;
  };

  while (i < n) {
    const c = src.charAt(i);
    if (c === '\\') {
      const next = src.charAt(i + 1);
      if (next === '\n') i += 2;
      else if (next === '\r' && src.charAt(i + 2) === '\n') i += 3;
      else {
        cur += next;
        inWord = true;
        i += 2;
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (inWord) tokens.push(cur);
      cur = '';
      inWord = false;
      i++;
      continue;
    }
    if (!inWord) {
      if (c === '#') {
        const nl = src.indexOf('\n', i);
        i = nl === -1 ? n : nl;
        continue;
      }
      if (c === '|' || c === ';' || c === '&' || c === '>' || c === '<') {
        return { tokens, shellVariables: [...vars], trailing: src.slice(i).trim() };
      }
    }
    inWord = true;
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end === -1) {
        warnings.push(UNCLOSED_QUOTE);
        cur += src.slice(i + 1);
        i = n;
      } else {
        cur += src.slice(i + 1, end);
        i = end + 1;
      }
    } else if (c === '$' && src.charAt(i + 1) === "'") {
      i = readAnsiC(i + 2);
    } else if (c === '$' && src.charAt(i + 1) === '"') {
      i = readDouble(i + 2);
    } else if (c === '"') {
      i = readDouble(i + 1);
    } else if (c === '$' && readVariable(i) !== -1) {
      // readVariable appended; recompute the index it stopped at.
      const re = /\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/y;
      re.lastIndex = i;
      i += re.exec(src)?.[0].length ?? 1;
    } else {
      cur += c;
      i++;
    }
  }
  if (inWord) tokens.push(cur);
  return { tokens, shellVariables: [...vars], trailing: '' };
}

/**
 * Split a Windows cmd.exe command. Two passes, as Windows does it: cmd.exe removes `^`
 * escapes (a caret before a line break joins the lines), then the C runtime splits
 * arguments on unquoted whitespace, with `\"` and `""` as literal quotes.
 *
 * DevTools "Copy as cURL (cmd)" quotes with `^"` and doubles every backslash before
 * escaping, so when that style is detected a doubled backslash not before a quote is
 * read back as one.
 */
function tokenizeCmd(src: string): string[] {
  const devtoolsStyle = src.includes('^"');
  let pass1 = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src.charAt(i);
    if (c === '"') {
      quoted = !quoted;
      pass1 += c;
      continue;
    }
    if (c !== '^' || quoted) {
      pass1 += c;
      continue;
    }
    let j = i + 1;
    if (src.charAt(j) === '\r' && src.charAt(j + 1) === '\n') j += 2;
    else if (src.charAt(j) === '\n') j += 1;
    // The escaped character: either the one after the caret, or the first of the next line.
    pass1 += src.charAt(j);
    i = j;
  }

  const tokens: string[] = [];
  let cur = '';
  let inWord = false;
  quoted = false;
  let i = 0;
  while (i < pass1.length) {
    const c = pass1.charAt(i);
    if (c === '\\') {
      let j = i;
      while (pass1.charAt(j) === '\\') j++;
      const count = j - i;
      if (pass1.charAt(j) === '"') {
        cur += '\\'.repeat(count >> 1);
        if (count % 2 === 1) {
          cur += '"';
          j++;
        }
      } else {
        cur += '\\'.repeat(devtoolsStyle ? Math.ceil(count / 2) : count);
      }
      i = j;
      inWord = true;
      continue;
    }
    if (c === '"') {
      if (quoted && pass1.charAt(i + 1) === '"') {
        cur += '"';
        i += 2;
      } else {
        quoted = !quoted;
        i++;
      }
      inWord = true;
      continue;
    }
    if (!quoted && (c === ' ' || c === '\t' || c === '\n' || c === '\r')) {
      if (inWord) tokens.push(cur);
      cur = '';
      inWord = false;
      i++;
      continue;
    }
    cur += c;
    inWord = true;
    i++;
  }
  if (inWord) tokens.push(cur);
  return tokens;
}

function looksLikeCmd(src: string): boolean {
  return /\^\r?\n/.test(src) || /(^|\s)\^"/.test(src);
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const SHORT_OPTIONS: Record<string, string> = {
  A: 'user-agent', b: 'cookie', c: 'cookie-jar', C: 'continue-at', d: 'data', D: 'dump-header',
  e: 'referer', E: 'cert', F: 'form', H: 'header', K: 'config', m: 'max-time', o: 'output',
  P: 'ftp-port', Q: 'quote', r: 'range', t: 'telnet-option', T: 'upload-file', u: 'user',
  U: 'proxy-user', w: 'write-out', x: 'proxy', X: 'request', y: 'speed-time', Y: 'speed-limit',
  z: 'time-cond',
  '0': 'http1.0', '1': 'tlsv1', '2': 'sslv2', '3': 'sslv3', '4': 'ipv4', '6': 'ipv6', a: 'append',
  B: 'use-ascii', f: 'fail', g: 'globoff', G: 'get', h: 'help', i: 'include', I: 'head',
  j: 'junk-session-cookies', J: 'remote-header-name', k: 'insecure', l: 'list-only', L: 'location',
  M: 'manual', n: 'netrc', N: 'no-buffer', O: 'remote-name', p: 'proxytunnel', q: 'disable',
  R: 'remote-time', s: 'silent', S: 'show-error', v: 'verbose', V: 'version', Z: 'parallel',
  '#': 'progress-bar', ':': 'next',
};

const words = (s: string) => new Set(s.trim().split(/\s+/));

/** Options that take a value. */
const VALUE_OPTIONS = words(`
  request header data data-ascii data-binary data-raw data-urlencode json form form-string user
  oauth2-bearer user-agent referer cookie url url-query upload-file range
  output output-dir max-time connect-timeout retry retry-delay retry-max-time write-out cookie-jar
  dump-header cacert capath cert cert-type key key-type pass resolve connect-to interface proxy
  proxy-user limit-rate max-redirs continue-at trace trace-ascii trace-config stderr config local-port
  dns-servers dns-interface tls-max ciphers tls13-ciphers curves time-cond speed-time speed-limit
  expect100-timeout keepalive-time keepalive-cnt noproxy unix-socket abstract-unix-socket aws-sigv4
  proto proto-default proto-redir parallel-max happy-eyeballs-timeout-ms socks4 socks4a socks5
  socks5-hostname socks5-gssapi-service preproxy proxy-header ftp-port quote telnet-option
  max-filesize request-target crlfile pinnedpubkey variable etag-save etag-compare netrc-file hsts
  alt-svc engine random-file egd-file delegation service-name sasl-authzid login-options mail-from
  mail-rcpt mail-auth proxy-cacert proxy-capath proxy-cert proxy-cert-type proxy-key proxy-key-type
  proxy-pass proxy-ciphers proxy-tls13-ciphers proxy-crlfile proxy-pinnedpubkey proxy-service-name
  tlsuser tlspassword tlsauthtype proxy-tlsuser proxy-tlspassword proxy-tlsauthtype doh-url
  ip-tos vlan-priority mptcp create-file-mode ftp-account ftp-alternative-to-user ftp-method
  ftp-ssl-ccc-mode krb libcurl ech ipfs-gateway
`);

/** Value options that change how the request is sent but cannot be carried over. */
const WARN_VALUE_OPTIONS = words(`
  proxy proxy-user cert key pass config unix-socket abstract-unix-socket aws-sigv4 variable
  preproxy socks4 socks4a socks5 socks5-hostname connect-to resolve request-target
`);

/** Switches with no effect on the request itself. */
const IGNORED_SWITCHES = words(`
  silent show-error location location-trusted insecure verbose include fail fail-with-body fail-early
  compressed compressed-ssh no-buffer buffer progress-bar remote-name remote-name-all
  remote-header-name remote-time netrc netrc-optional globoff http1.0 http1.1 http2
  http2-prior-knowledge http3 http3-only http0.9 tlsv1 tlsv1.0 tlsv1.1 tlsv1.2 tlsv1.3 sslv2 sslv3
  ipv4 ipv6 tcp-nodelay tcp-fastopen keepalive sessionid alpn npn path-as-is raw tr-encoding ssl
  ssl-reqd ssl-no-revoke ssl-revoke-best-effort ssl-allow-beast ssl-auto-client-cert retry-all-errors
  retry-connrefused basic disable parallel parallel-immediate styled-output progress-meter
  junk-session-cookies create-dirs crlf use-ascii list-only xattr false-start cert-status
  proxy-insecure proxytunnel suppress-connect-headers manual version help append doh-insecure
  ignore-content-length skip-existing remove-on-error clobber metalink disallow-username-in-url
  proxy-basic proxy-digest proxy-ntlm proxy-negotiate proxy-anyauth ca-native proxy-ca-native
  trace-time trace-ids ssl-sessions no-progress-meter
`);

const UNSUPPORTED_AUTH = words('digest ntlm ntlm-wb negotiate anyauth');

function looksLikeUrl(s: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ||
    s.startsWith('{{') ||
    /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\]|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]|$)/i.test(s)
  );
}

/** Percent-encode like curl's --data-urlencode, but leave `{{variables}}` readable. */
function encodeKeepingVariables(s: string): string {
  return s
    .split(/(\{\{\w+\}\})/)
    .map((part, k) => (k % 2 === 1 ? part : encodeURIComponent(part)))
    .join('');
}

/** `--data-urlencode` forms: `content`, `=content`, `name=content`, `@file`, `name@file`. */
function dataUrlencode(arg: string): { text: string } | { file: string } {
  const eq = arg.indexOf('=');
  const at = arg.indexOf('@');
  if (eq !== -1 && (at === -1 || eq < at)) {
    const name = arg.slice(0, eq);
    const content = encodeKeepingVariables(arg.slice(eq + 1));
    return { text: name ? `${name}=${content}` : content };
  }
  if (at !== -1) return { file: arg.slice(at + 1) };
  return { text: encodeKeepingVariables(arg) };
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** One `-F name=value` argument. `literal` is `--form-string`. */
function formField(arg: string, literal: boolean, warnings: string[]): MultipartField | null {
  const eq = arg.indexOf('=');
  if (eq === -1) {
    warnings.push(`Ignored the form field "${arg}" because it has no "=".`);
    return null;
  }
  const key = arg.slice(0, eq);
  const rest = arg.slice(eq + 1);
  if (literal) return { key, value: rest, enabled: true, kind: 'text' };

  let value: string;
  let paramsText: string;
  if (rest.startsWith('"')) {
    let j = 1;
    while (j < rest.length && rest.charAt(j) !== '"') j += rest.charAt(j) === '\\' ? 2 : 1;
    value = rest.slice(1, j).replace(/\\(["\\])/g, '$1');
    paramsText = rest.slice(j + 1);
  } else {
    const segs = rest.split(';');
    value = segs[0] ?? '';
    let k = 1;
    // A `;` that does not start a known parameter is part of the value.
    while (k < segs.length && !/^\s*(type|filename|headers|encoder)=/i.test(segs[k] ?? '')) {
      value += `;${segs[k]}`;
      k++;
    }
    paramsText = segs.slice(k).join(';');
  }
  const filename = /(?:^|;)\s*filename="?([^";]*)"?/i.exec(paramsText)?.[1];

  if (value.startsWith('@')) {
    const name = filename || basename(value.slice(1));
    warnings.push(reattachWarning(key));
    return { key, value: name, enabled: true, kind: 'file' };
  }
  if (value.startsWith('<')) {
    warnings.push(`The contents of "${value.slice(1)}" for the "${key}" field were not imported. Paste them in.`);
    return { key, value: '', enabled: true, kind: 'text' };
  }
  return { key, value, enabled: true, kind: 'text' };
}

// ---------------------------------------------------------------------------
// parseCurl
// ---------------------------------------------------------------------------

/**
 * Parse a curl command into a request. Throws an Error with a user-facing message when
 * the text is not a curl command or has no URL; everything else is a warning.
 */
export function parseCurl(command: string): ImportResult<ApiRequest> {
  const warnings: string[] = [];
  const src = command.replace(/^\uFEFF/, '').trim().replace(/^\$\s+/, '');
  if (!src) throw new Error('Paste a curl command to import.');

  let tokenized: Tokenized;
  if (looksLikeCmd(src)) tokenized = { tokens: tokenizeCmd(src), shellVariables: [], trailing: '' };
  else tokenized = tokenizePosix(src, warnings);

  let args = tokenized.tokens;
  const first = args[0] ?? '';
  if (/^(?:.*[\\/])?curl(?:\.exe)?$/i.test(first)) {
    args = args.slice(1);
  } else if (!first.startsWith('-') && !looksLikeUrl(first)) {
    throw new Error('This is not a curl command. Paste a command that starts with "curl".');
  }

  let explicitMethod: string | undefined;
  let head = false;
  let get = false;
  let upload = false;
  let jsonFlag = false;
  let hasData = false;
  let user: string | undefined;
  let bearer: string | undefined;
  let headers: KeyValuePair[] = [];
  const cookies: string[] = [];
  const data: string[] = [];
  let jsonData = '';
  const urlQuery: string[] = [];
  const form: MultipartField[] = [];
  const positional: string[] = [];
  const unknown = new Set<string>();
  const ignoredValues = new Set<string>();
  let unsupportedAuth: string | undefined;

  const addHeader = (key: string, value: string) => headers.push({ key, value, enabled: true });

  const handle = (name: string, value: string): 'stop' | void => {
    switch (name) {
      case 'request':
        explicitMethod = value;
        break;
      case 'header': {
        if (value.startsWith('@')) {
          warnings.push(`Headers from the file "${value.slice(1)}" were not imported.`);
          break;
        }
        const colon = value.indexOf(':');
        if (colon === -1) {
          // `-H 'X-Empty;'` sends the header with an empty value.
          if (value.trim().endsWith(';')) addHeader(value.trim().slice(0, -1).trim(), '');
          else if (value.trim()) warnings.push(`Ignored the header "${value}" because it has no ":".`);
          break;
        }
        const key = value.slice(0, colon).trim();
        const v = value.slice(colon + 1).trim();
        // `-H 'Accept:'` removes a header curl would add; there is nothing to import.
        if (key && v !== '') addHeader(key, v);
        break;
      }
      case 'data':
      case 'data-ascii':
      case 'data-binary':
        hasData = true;
        if (value.startsWith('@')) warnings.push(`The body from the file "${value.slice(1)}" was not imported. Paste it into the body.`);
        else data.push(value);
        break;
      case 'data-raw':
        hasData = true;
        data.push(value);
        break;
      case 'data-urlencode': {
        hasData = true;
        const r = dataUrlencode(value);
        if ('file' in r) warnings.push(`The body from the file "${r.file}" was not imported. Paste it into the body.`);
        else data.push(r.text);
        break;
      }
      case 'json':
        hasData = true;
        jsonFlag = true;
        if (value.startsWith('@')) warnings.push(`The body from the file "${value.slice(1)}" was not imported. Paste it into the body.`);
        else jsonData += value;
        break;
      case 'form':
      case 'form-string': {
        const f = formField(value, name === 'form-string', warnings);
        if (f) form.push(f);
        break;
      }
      case 'user':
        user = value;
        break;
      case 'oauth2-bearer':
        bearer = value;
        break;
      case 'user-agent':
        addHeader('User-Agent', value);
        break;
      case 'referer': {
        const ref = value.replace(/;?auto$/, '');
        if (ref) addHeader('Referer', ref);
        break;
      }
      case 'cookie':
        if (value.includes('=')) cookies.push(value);
        else warnings.push(`Cookies from the file "${value}" were not imported.`);
        break;
      case 'url':
        positional.push(value);
        break;
      case 'url-query': {
        if (value.startsWith('+')) {
          urlQuery.push(value.slice(1));
        } else {
          const r = dataUrlencode(value);
          if ('file' in r) warnings.push(`The query from the file "${r.file}" was not imported.`);
          else urlQuery.push(r.text);
        }
        break;
      }
      case 'get':
        get = true;
        break;
      case 'head':
        head = true;
        break;
      case 'upload-file':
        upload = true;
        warnings.push(`The file "${value}" to upload was not imported. Choose it as the binary body.`);
        break;
      case 'range':
        addHeader('Range', `bytes=${value}`);
        break;
      case 'next':
        warnings.push('Only the first request was imported; everything after --next was ignored.');
        return 'stop';
      default:
        if (UNSUPPORTED_AUTH.has(name)) unsupportedAuth = name;
        else if (WARN_VALUE_OPTIONS.has(name)) ignoredValues.add(`--${name}`);
    }
  };

  for (let k = 0; k < args.length; k++) {
    const tok = args[k] ?? '';
    const takeNext = (): string | undefined => {
      if (k + 1 >= args.length) return undefined;
      k++;
      return args[k];
    };

    if (tok === '--') {
      positional.push(...args.slice(k + 1));
      break;
    }
    if (tok.startsWith('--')) {
      let name = tok.slice(2);
      let value: string | undefined;
      const eq = name.indexOf('=');
      if (eq !== -1 && !VALUE_OPTIONS.has(name) && !IGNORED_SWITCHES.has(name)) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      if (VALUE_OPTIONS.has(name)) {
        value ??= takeNext();
        if (value === undefined) {
          warnings.push(`--${name} has no value and was ignored.`);
          break;
        }
        if (handle(name, value) === 'stop') break;
      } else if (IGNORED_SWITCHES.has(name) || (name.startsWith('no-') && IGNORED_SWITCHES.has(name.slice(3)))) {
        // No effect on the request.
      } else if (['get', 'head', 'next'].includes(name) || UNSUPPORTED_AUTH.has(name)) {
        if (handle(name, '') === 'stop') break;
      } else {
        unknown.add(`--${name}`);
      }
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1) {
      let stop = false;
      for (let c = 1; c < tok.length; c++) {
        const ch = tok.charAt(c);
        const name = SHORT_OPTIONS[ch];
        if (!name) {
          unknown.add(`-${ch}`);
          break;
        }
        if (VALUE_OPTIONS.has(name)) {
          const attached = tok.slice(c + 1);
          const value = attached !== '' ? attached : takeNext();
          if (value === undefined) warnings.push(`-${ch} has no value and was ignored.`);
          else if (handle(name, value) === 'stop') stop = true;
          break;
        }
        if (handle(name, '') === 'stop') {
          stop = true;
          break;
        }
      }
      if (stop) break;
      continue;
    }
    positional.push(tok);
  }

  if (positional.length === 0) throw new Error('No URL found in the curl command.');
  const chosen = positional.find(looksLikeUrl) ?? positional[0] ?? '';
  const extra = positional.filter(p => p !== chosen);
  if (extra.length > 0) warnings.push(`Only one URL is imported; ignored: ${extra.join(', ')}.`);
  if (unknown.size > 0) warnings.push(`Ignored unknown options: ${[...unknown].join(', ')}.`);
  if (ignoredValues.size > 0) warnings.push(`These options cannot be carried over and were ignored: ${[...ignoredValues].join(', ')}.`);
  if (tokenized.trailing) warnings.push(`Only the curl command was imported; ignored "${tokenized.trailing}".`);
  if (tokenized.shellVariables.length > 0) {
    warnings.push(`Shell variables became {{variables}}: ${tokenized.shellVariables.join(', ')}. Define them in an environment.`);
  }

  // URL and method.
  const dataText = data.join('&') + jsonData;
  let url = chosen;
  if (urlQuery.length > 0) url = appendQuery(url, urlQuery.join('&'));
  if (get && hasData) url = appendQuery(url, dataText);

  let method: HttpMethod = head ? 'HEAD' : get ? 'GET' : upload ? 'PUT' : hasData || form.length > 0 ? 'POST' : 'GET';
  if (explicitMethod !== undefined) {
    const m = explicitMethod.toUpperCase();
    if ((HTTP_METHODS as string[]).includes(m)) method = m as HttpMethod;
    else warnings.push(`The ${m} method is not supported, so the request uses ${method}.`);
  }

  // Headers and auth.
  if (cookies.length > 0) addHeader('Cookie', cookies.join('; '));
  if (jsonFlag && headerValue(headers, 'accept') === undefined) addHeader('Accept', 'application/json');

  const req = newRequest(requestNameFromUrl(method, url));
  req.method = method;
  req.url = url;
  req.params = queryParamsFromUrl(url);

  const fromHeader = authFromHeaders(headers);
  headers = fromHeader.headers;
  if (fromHeader.auth) {
    req.auth = fromHeader.auth;
  } else if (bearer !== undefined) {
    req.auth = { type: 'bearer', token: bearer };
  } else if (user !== undefined) {
    const colon = user.indexOf(':');
    req.auth = {
      type: 'basic',
      username: colon === -1 ? user : user.slice(0, colon),
      password: colon === -1 ? '' : user.slice(colon + 1),
    };
    if (unsupportedAuth) warnings.push(`--${unsupportedAuth} authentication is not supported; the credentials were imported as Basic auth.`);
  }
  req.headers = headers;

  // Body.
  if (form.length > 0) {
    req.bodyType = 'multipart';
    req.multipartFields = form;
    if (hasData) warnings.push('curl cannot send -d data and -F form fields together; only the form fields were imported.');
    if (mediaTypeOf(headerValue(req.headers, 'content-type') ?? '') === 'multipart/form-data') {
      req.headers = removeHeaders(req.headers, 'content-type');
    }
  } else if (upload) {
    req.bodyType = 'binary';
  } else if (hasData && !get) {
    const contentType = headerValue(req.headers, 'content-type') ?? (jsonFlag ? 'application/json' : undefined);
    applyTextBody(req, dataText, contentType, warnings);
  }

  return { value: req, warnings };
}
