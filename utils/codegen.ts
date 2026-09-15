/**
 * Code generation: turn a ResolvedRequest into a copy-paste runnable snippet.
 *
 * Every user-supplied string (URL, header names and values, body text, form
 * fields, file names) goes through the literal helper for the target language,
 * so the snippet sends the same bytes the extension sends. Unpaired UTF-16
 * surrogates become U+FFFD first, which is what the extension's own UTF-8
 * encoding does.
 *
 * Known limits of the targets themselves (not escaping bugs):
 * - Shells cannot carry a NUL byte in an argument.
 * - curl `-F`/`--form-string` and HTTPie items split the field name at the
 *   first `=`, so a multipart field name containing `=` cannot be expressed.
 * - HTTPie drops a backslash that precedes `:` `;` `=` `@` in an item. For
 *   urlencoded bodies that need one, the body is sent pre-encoded via `--raw`;
 *   headers and multipart fields have no such fallback. HTTPie also sends
 *   multipart text fields before file fields.
 * - Python requests and PHP arrays cannot repeat a header / multipart name:
 *   Python joins repeated header values with ", ", and PHP keeps the last
 *   multipart value (a NOTE comment says so).
 * - .NET's MultipartFormDataContent adds `filename*=` and rejects names
 *   containing `"`; urlencoded bytes differ between targets only in which
 *   safe characters get percent-encoded (the decoded fields are identical).
 */

import type { FileRef, HttpMethod, ResolvedRequest } from './request';

export type CodegenTarget = 'curl' | 'fetch' | 'axios' | 'python' | 'go' | 'php' | 'csharp' | 'httpie';

export const CODEGEN_TARGETS: Array<{ id: CodegenTarget; label: string; language: string }> = [
  { id: 'curl', label: 'cURL', language: 'shell' },
  { id: 'fetch', label: 'JavaScript fetch', language: 'javascript' },
  { id: 'axios', label: 'Node.js axios', language: 'javascript' },
  { id: 'python', label: 'Python requests', language: 'python' },
  { id: 'go', label: 'Go net/http', language: 'go' },
  { id: 'php', label: 'PHP cURL', language: 'php' },
  { id: 'csharp', label: 'C# HttpClient', language: 'csharp' },
  { id: 'httpie', label: 'HTTPie', language: 'shell' },
];

/** Generate a runnable snippet for `target` that sends `req`. */
export function generateCode(target: CodegenTarget, req: ResolvedRequest): string {
  switch (target) {
    case 'fetch': return fetchCode(req);
    case 'axios': return axiosCode(req);
    case 'curl': return curlCode(withFormDataNewlines(req));
    case 'python': return pythonCode(withFormDataNewlines(req));
    case 'go': return goCode(withFormDataNewlines(req));
    case 'php': return phpCode(withFormDataNewlines(req));
    case 'csharp': return csharpCode(withFormDataNewlines(req));
    case 'httpie': return httpieCode(withFormDataNewlines(req));
  }
}

/**
 * The extension sends multipart bodies as FormData, which turns every bare CR
 * or LF in field names and text values into CRLF. The fetch and axios snippets
 * use FormData too and get that for free; the other targets are handed the
 * already-normalized text so they send the same bytes.
 */
function withFormDataNewlines(req: ResolvedRequest): ResolvedRequest {
  if (req.body.kind !== 'multipart') return req;
  const crlf = (s: string) => s.replace(/\r\n|\r|\n/g, '\r\n');
  const fields = req.body.fields.map(f => ({
    ...f,
    name: crlf(f.name),
    ...(f.value === undefined ? {} : { value: crlf(f.value) }),
  }));
  return { ...req, body: { kind: 'multipart', fields } };
}

// ---------------------------------------------------------------------------
// Literal helpers
// ---------------------------------------------------------------------------

/** Replace unpaired UTF-16 surrogates with U+FFFD. */
export function toWellFormed(s: string): string {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/** Characters that are legal but invisible or line-breaking; escaped wherever the language allows. */
const INVISIBLE = /[\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/;
const INVISIBLE_G = new RegExp(INVISIBLE.source, 'g');

function hex(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}

/** POSIX shell single-quoted word: `'` becomes `'\''`. Everything else is literal. */
export function shellQuote(s: string): string {
  return `'${toWellFormed(s).replace(/'/g, `'\\''`)}'`;
}

/** JavaScript string literal (JSON.stringify plus escapes for invisible characters). */
export function jsString(s: string): string {
  return JSON.stringify(toWellFormed(s)).replace(INVISIBLE_G, c => `\\u${hex(c.charCodeAt(0), 4)}`);
}

function cStyleString(s: string, escapeCodePoint: (cp: number) => string): string {
  let out = '"';
  for (const ch of toWellFormed(s)) {
    const cp = ch.codePointAt(0) ?? 0;
    switch (ch) {
      case '\\': out += '\\\\'; break;
      case '"': out += '\\"'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      default: out += cp < 0x20 || INVISIBLE.test(ch) ? escapeCodePoint(cp) : ch;
    }
  }
  return `${out}"`;
}

/** Python 3 double-quoted str literal (`\xHH` is a code point in a str). */
export function pythonString(s: string): string {
  return cStyleString(s, cp => (cp < 0x100 ? `\\x${hex(cp, 2)}` : `\\u${hex(cp, 4)}`));
}

/** Go interpreted string literal, strconv.Quote style (`\x` only for ASCII, since it is a byte). */
export function goString(s: string): string {
  return cStyleString(s, cp => (cp < 0x80 ? `\\x${hex(cp, 2)}` : `\\u${hex(cp, 4)}`));
}

/** C# regular string literal (`\u` only; C#'s `\x` is variable-length). */
export function csharpString(s: string): string {
  return cStyleString(s, cp => `\\u${hex(cp, 4)}`);
}

/** PHP single-quoted string: only `\\` and `\'` are escapes. */
export function phpString(s: string): string {
  return `'${toWellFormed(s).replace(/[\\']/g, c => `\\${c}`)}'`;
}

/** application/x-www-form-urlencoded byte serialization, as URLSearchParams does it. */
export function formUrlEncode(s: string): string {
  return encodeURIComponent(toWellFormed(s))
    .replace(/[!'()~]/g, c => `%${hex(c.charCodeAt(0), 2)}`)
    .replace(/%20/g, '+');
}

/** A file name for a line comment (quoted, escaped, cannot end the comment). */
function commentName(name: string): string {
  return jsString(name);
}

function fileTodo(file: FileRef, prefix: string): string {
  return `${prefix} TODO: choose ${commentName(file.name)}`;
}

function partType(file: FileRef): string {
  return file.type || 'application/octet-stream';
}

function hasHeader(headers: Array<[string, string]>, name: string): boolean {
  const lower = name.toLowerCase();
  return headers.some(([n]) => n.toLowerCase() === lower);
}

/** Group headers by case-insensitive name, keeping the first spelling and first-seen order. */
function groupHeaders(headers: Array<[string, string]>): Array<[string, string[]]> {
  const groups: Array<[string, string[]]> = [];
  const byName = new Map<string, string[]>();
  for (const [name, value] of headers) {
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      existing.push(value);
    } else {
      const values = [value];
      byName.set(name.toLowerCase(), values);
      groups.push([name, values]);
    }
  }
  return groups;
}

function hasDuplicateKeys(keys: string[]): boolean {
  return new Set(keys).size !== keys.length;
}

/** Content-Disposition quoting as browsers do it for multipart names. */
function dispositionQuote(s: string): string {
  return `"${s.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22')}"`;
}

// ---------------------------------------------------------------------------
// curl
// ---------------------------------------------------------------------------

/** A -F text value curl will not reinterpret (no leading @ < ( ", no ; or quotes, no edge spaces). */
const CURL_SIMPLE_FORM_VALUE = /^(?:[\p{L}\p{N}_.~:/?#!$&*+,=%-]+(?: [\p{L}\p{N}_.~:/?#!$&*+,=%-]+)*)?$/u;
const CURL_SIMPLE_FILENAME = /^[\p{L}\p{N}_.~+\-()[\]!#%&]+(?: [\p{L}\p{N}_.~+\-()[\]!#%&]+)*$/u;
const SIMPLE_MIME = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

/** A path curl reads as a file, never as stdin. */
function curlPath(name: string): string {
  return name === '-' ? './-' : name;
}

function curlFormFile(file: FileRef): string {
  const path = curlPath(file.name);
  const word = CURL_SIMPLE_FILENAME.test(path) ? path : `"${path.replace(/[\\"]/g, c => `\\${c}`)}"`;
  const type = partType(file);
  return SIMPLE_MIME.test(type) ? `${word};type=${type}` : word;
}

function curlCode(req: ResolvedRequest): string {
  const { body } = req;
  const hasBody = body.kind !== 'none';
  let first = 'curl';
  if (req.method === 'HEAD' && !hasBody) first += ' --head';
  else if (req.method !== 'GET' || hasBody) first += ` -X ${req.method}`;
  if (/[[\]{}]/.test(req.url)) first += ' --globoff';
  first += ` ${shellQuote(req.url)}`;

  const parts = [first];
  for (const [name, value] of req.headers) {
    // `-H 'Name:'` would delete the header; `Name;` sends it empty.
    parts.push(`-H ${shellQuote(value === '' ? `${name};` : `${name}: ${value}`)}`);
  }

  switch (body.kind) {
    case 'text':
      parts.push(`--data-raw ${shellQuote(body.text)}`);
      break;
    case 'urlencoded':
      for (const [key, value] of body.fields) {
        // curl drops the `=` when the name is empty, so pre-encode that pair.
        parts.push(key === ''
          ? `--data-raw ${shellQuote(`=${formUrlEncode(value)}`)}`
          : `--data-urlencode ${shellQuote(`${formUrlEncode(key)}=${value}`)}`);
      }
      break;
    case 'multipart':
      for (const field of body.fields) {
        if (field.file) {
          parts.push(`-F ${shellQuote(`${field.name}=@${curlFormFile(field.file)}`)}`);
        } else {
          const value = field.value ?? '';
          const flag = CURL_SIMPLE_FORM_VALUE.test(value) ? '-F' : '--form-string';
          parts.push(`${flag} ${shellQuote(`${field.name}=${value}`)}`);
        }
      }
      break;
    case 'binary':
      parts.push(`--data-binary ${shellQuote(`@${curlPath(body.file.name)}`)}`);
      break;
  }
  return parts.join(' \\\n  ');
}

// ---------------------------------------------------------------------------
// JavaScript: fetch and axios
// ---------------------------------------------------------------------------

function jsPairs(pairs: Array<[string, string]>, indent: string): string {
  if (pairs.length === 0) return '[]';
  const rows = pairs.map(([k, v]) => `${indent}  [${jsString(k)}, ${jsString(v)}],`);
  return `[\n${rows.join('\n')}\n${indent}]`;
}

function fetchCode(req: ResolvedRequest): string {
  const { body } = req;
  const pre: string[] = [];
  const options = [`  method: ${jsString(req.method)},`];

  if (req.headers.length > 0) {
    const groups = groupHeaders(req.headers);
    if (groups.length === req.headers.length) {
      const rows = req.headers.map(([k, v]) => `    ${jsString(k)}: ${jsString(v)},`);
      options.push(`  headers: {\n${rows.join('\n')}\n  },`);
    } else {
      // A repeated name needs the array form; an object would keep only one.
      options.push(`  headers: ${jsPairs(req.headers, '  ')},`);
    }
  }

  switch (body.kind) {
    case 'text':
      options.push(`  body: ${jsString(body.text)},`);
      break;
    case 'urlencoded':
      options.push(`  body: new URLSearchParams(${jsPairs(body.fields, '  ')}),`);
      break;
    case 'multipart':
      pre.push('const form = new FormData();');
      for (const field of body.fields) {
        if (field.file) {
          pre.push(`${fileTodo(field.file, '//')} (replace this empty Blob with the file, e.g. from an <input type="file">)`);
          pre.push(`form.append(${jsString(field.name)}, new Blob([], { type: ${jsString(partType(field.file))} }), ${jsString(field.file.name)});`);
        } else {
          pre.push(`form.append(${jsString(field.name)}, ${jsString(field.value ?? '')});`);
        }
      }
      options.push('  body: form,');
      break;
    case 'binary':
      pre.push(`${fileTodo(body.file, '//')} (replace this empty Blob with the file, e.g. from an <input type="file">)`);
      pre.push('const file = new Blob([]);');
      options.push('  body: file,');
      break;
  }

  const lines = [...pre];
  if (pre.length > 0) lines.push('');
  lines.push(`const response = await fetch(${jsString(req.url)}, {`, ...options, '});', '');
  lines.push('console.log(response.status);', 'console.log(await response.text());');
  return lines.join('\n');
}

function axiosCode(req: ResolvedRequest): string {
  const { body } = req;
  const imports = ['import axios from "axios";'];
  const pre: string[] = [];
  const options = [`  method: ${jsString(req.method)},`, `  url: ${jsString(req.url)},`];

  if (req.headers.length > 0) {
    const rows = groupHeaders(req.headers).map(([name, values]) => {
      // axios sends an array value as repeated header lines.
      const value = values.length === 1 ? jsString(values[0] ?? '') : `[${values.map(jsString).join(', ')}]`;
      return `    ${jsString(name)}: ${value},`;
    });
    options.push(`  headers: {\n${rows.join('\n')}\n  },`);
  }

  switch (body.kind) {
    case 'text':
      options.push(`  data: ${jsString(body.text)},`);
      options.push('  // Send the text as-is; axios would otherwise trim or re-serialize JSON.');
      options.push('  transformRequest: [(data) => data],');
      break;
    case 'urlencoded':
      options.push(`  data: new URLSearchParams(${jsPairs(body.fields, '  ')}),`);
      break;
    case 'multipart':
      pre.push('const form = new FormData();');
      for (const field of body.fields) {
        if (field.file) {
          imports.push('import { readFileSync } from "node:fs";');
          pre.push(fileTodo(field.file, '//'));
          pre.push(`form.append(${jsString(field.name)}, new Blob([readFileSync(${jsString(field.file.name)})], { type: ${jsString(partType(field.file))} }), ${jsString(field.file.name)});`);
        } else {
          pre.push(`form.append(${jsString(field.name)}, ${jsString(field.value ?? '')});`);
        }
      }
      options.push('  data: form,');
      break;
    case 'binary':
      imports.push('import { readFileSync } from "node:fs";');
      pre.push(fileTodo(body.file, '//'));
      pre.push(`const file = readFileSync(${jsString(body.file.name)});`);
      options.push('  data: file,');
      break;
  }
  options.push('  // Resolve for every status instead of throwing on 4xx/5xx.');
  options.push('  validateStatus: () => true,');

  const lines = [...new Set(imports), ''];
  if (pre.length > 0) lines.push(...pre, '');
  lines.push('const response = await axios({', ...options, '});', '');
  lines.push('console.log(response.status);', 'console.log(response.data);');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Python requests
// ---------------------------------------------------------------------------

function pythonCode(req: ResolvedRequest): string {
  const { body } = req;
  const lines = ['import requests', '', `url = ${pythonString(req.url)}`];
  const args = [pythonString(req.method), 'url'];

  if (req.headers.length > 0) {
    // requests takes a dict, so a repeated name is sent once with its values joined.
    const rows = groupHeaders(req.headers).map(([name, values]) => `    ${pythonString(name)}: ${pythonString(values.join(', '))},`);
    lines.push('headers = {', ...rows, '}');
    args.push('headers=headers');
  }

  switch (body.kind) {
    case 'text':
      lines.push(`payload = ${pythonString(body.text)}`);
      // A str body would be encoded as Latin-1 by http.client; send UTF-8 bytes.
      args.push('data=payload.encode("utf-8")');
      break;
    case 'urlencoded':
      if (hasDuplicateKeys(body.fields.map(([k]) => k))) {
        lines.push('data = [', ...body.fields.map(([k, v]) => `    (${pythonString(k)}, ${pythonString(v)}),`), ']');
      } else {
        lines.push('data = {', ...body.fields.map(([k, v]) => `    ${pythonString(k)}: ${pythonString(v)},`), '}');
      }
      args.push('data=data');
      break;
    case 'multipart':
      // One ordered list keeps field order; (None, value) is a plain text field.
      lines.push('files = [');
      for (const field of body.fields) {
        if (field.file) {
          const f = field.file;
          lines.push(`    ${fileTodo(f, '#')}`);
          lines.push(`    (${pythonString(field.name)}, (${pythonString(f.name)}, open(${pythonString(f.name)}, "rb"), ${pythonString(partType(f))})),`);
        } else {
          lines.push(`    (${pythonString(field.name)}, (None, ${pythonString(field.value ?? '')})),`);
        }
      }
      lines.push(']');
      args.push('files=files');
      break;
    case 'binary':
      lines.push(fileTodo(body.file, '#'));
      lines.push(`data = open(${pythonString(body.file.name)}, "rb")`);
      args.push('data=data');
      break;
  }

  lines.push('', `response = requests.request(${args.join(', ')})`, '');
  lines.push('print(response.status_code)', 'print(response.text)');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Go net/http
// ---------------------------------------------------------------------------

function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i]?.codePointAt(0) ?? 0) - (y[i]?.codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function goCode(req: ResolvedRequest): string {
  const { body } = req;
  const imports = new Set(['fmt', 'io', 'net/http']);
  const pre: string[] = [];
  const post: string[] = [];
  let bodyVar = 'nil';
  const check = ['\tif err != nil {', '\t\tpanic(err)', '\t}'];

  switch (body.kind) {
    case 'text':
      imports.add('strings');
      pre.push(`\tbody := strings.NewReader(${goString(body.text)})`);
      bodyVar = 'body';
      break;
    case 'urlencoded': {
      imports.add('net/url').add('strings');
      const keys = body.fields.map(([k]) => toWellFormed(k));
      const sorted = keys.every((k, i) => i === 0 || compareCodePoints(keys[i - 1] ?? '', k) <= 0);
      if (sorted) {
        pre.push('\tform := url.Values{}');
        for (const [k, v] of body.fields) pre.push(`\tform.Add(${goString(k)}, ${goString(v)})`);
        pre.push('\tbody := strings.NewReader(form.Encode())');
      } else {
        pre.push('\t// Joined by hand to keep field order; url.Values.Encode sorts by name.');
        pre.push('\tbody := strings.NewReader(strings.Join([]string{');
        for (const [k, v] of body.fields) pre.push(`\t\turl.QueryEscape(${goString(k)}) + "=" + url.QueryEscape(${goString(v)}),`);
        pre.push('\t}, "&"))');
      }
      bodyVar = 'body';
      break;
    }
    case 'multipart':
      imports.add('bytes').add('mime/multipart');
      pre.push('\tbody := &bytes.Buffer{}', '\tform := multipart.NewWriter(body)');
      body.fields.forEach((field, i) => {
        if (field.file) {
          imports.add('os').add('net/textproto');
          const f = field.file;
          const disposition = `form-data; name=${dispositionQuote(field.name)}; filename=${dispositionQuote(f.name)}`;
          pre.push(`\t${fileTodo(f, '//')}`);
          pre.push(`\tfile${i}, err := os.ReadFile(${goString(f.name)})`, ...check);
          pre.push(`\tpart${i}Header := textproto.MIMEHeader{}`);
          pre.push(`\tpart${i}Header.Set("Content-Disposition", ${goString(disposition)})`);
          pre.push(`\tpart${i}Header.Set("Content-Type", ${goString(partType(f))})`);
          pre.push(`\tpart${i}, err := form.CreatePart(part${i}Header)`, ...check);
          pre.push(`\tif _, err := part${i}.Write(file${i}); err != nil {`, '\t\tpanic(err)', '\t}');
        } else {
          pre.push(`\tif err := form.WriteField(${goString(field.name)}, ${goString(field.value ?? '')}); err != nil {`, '\t\tpanic(err)', '\t}');
        }
      });
      pre.push('\tif err := form.Close(); err != nil {', '\t\tpanic(err)', '\t}');
      if (!hasHeader(req.headers, 'Content-Type')) post.push('\treq.Header.Set("Content-Type", form.FormDataContentType())');
      bodyVar = 'body';
      break;
    case 'binary':
      imports.add('bytes').add('os');
      pre.push(`\t${fileTodo(body.file, '//')}`);
      pre.push(`\tdata, err := os.ReadFile(${goString(body.file.name)})`, ...check);
      pre.push('\tbody := bytes.NewReader(data)');
      bodyVar = 'body';
      break;
  }

  const lines = ['package main', '', 'import ('];
  for (const name of [...imports].sort()) lines.push(`\t"${name}"`);
  lines.push(')', '', 'func main() {');
  if (pre.length > 0) lines.push(...pre, '');
  lines.push(`\treq, err := http.NewRequest(${goString(req.method)}, ${goString(req.url)}, ${bodyVar})`, ...check);
  for (const [name, value] of req.headers) {
    // net/http ignores a Host entry in req.Header; it reads req.Host.
    lines.push(name.toLowerCase() === 'host'
      ? `\treq.Host = ${goString(value)}`
      : `\treq.Header.Add(${goString(name)}, ${goString(value)})`);
  }
  lines.push(...post, '');
  lines.push('\tres, err := http.DefaultClient.Do(req)', ...check, '\tdefer res.Body.Close()', '');
  lines.push('\tresBody, err := io.ReadAll(res.Body)', ...check, '');
  lines.push('\tfmt.Println(res.Status)', '\tfmt.Println(string(resBody))', '}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// PHP cURL
// ---------------------------------------------------------------------------

function phpCode(req: ResolvedRequest): string {
  const { body } = req;
  const hasBody = body.kind !== 'none';
  // `?>` ends a PHP line comment, so keep it out of comments.
  const phpTodo = (file: FileRef) => fileTodo(file, '//').replace(/\?>/g, '?\\>');
  const opts = [`CURLOPT_URL => ${phpString(req.url)},`, 'CURLOPT_RETURNTRANSFER => true,'];

  if (req.method === 'HEAD') {
    opts.push('CURLOPT_NOBODY => true,');
    if (hasBody) opts.push(`CURLOPT_CUSTOMREQUEST => 'HEAD',`);
  } else if (req.method !== 'GET' || hasBody) {
    opts.push(`CURLOPT_CUSTOMREQUEST => ${phpString(req.method)},`);
  }

  if (req.headers.length > 0) {
    opts.push('CURLOPT_HTTPHEADER => [');
    for (const [name, value] of req.headers) {
      // 'Name:' would remove the header; 'Name;' sends it empty.
      opts.push(`    ${phpString(value === '' ? `${name};` : `${name}: ${value}`)},`);
    }
    opts.push('],');
  }

  switch (body.kind) {
    case 'text':
      opts.push(`CURLOPT_POSTFIELDS => ${phpString(body.text)},`);
      break;
    case 'urlencoded':
      if (hasDuplicateKeys(body.fields.map(([k]) => k))) {
        // A PHP array cannot repeat a key, so encode each pair.
        opts.push(`CURLOPT_POSTFIELDS => implode('&', [`);
        for (const [k, v] of body.fields) opts.push(`    urlencode(${phpString(k)}) . '=' . urlencode(${phpString(v)}),`);
        opts.push(']),');
      } else {
        opts.push('CURLOPT_POSTFIELDS => http_build_query([');
        for (const [k, v] of body.fields) opts.push(`    ${phpString(k)} => ${phpString(v)},`);
        opts.push(`], '', '&'),`);
      }
      break;
    case 'multipart': {
      opts.push('CURLOPT_POSTFIELDS => [');
      const seen = new Set<string>();
      for (const field of body.fields) {
        if (seen.has(field.name)) {
          opts.push(`    // NOTE: PHP arrays cannot repeat a key; only the last ${commentName(field.name).replace(/\?>/g, '?\\>')} is sent.`);
        }
        seen.add(field.name);
        if (field.file) {
          const f = field.file;
          opts.push(`    ${phpTodo(f)}`);
          opts.push(`    ${phpString(field.name)} => new CURLFile(${phpString(f.name)}, ${phpString(partType(f))}, ${phpString(f.name)}),`);
        } else {
          opts.push(`    ${phpString(field.name)} => ${phpString(field.value ?? '')},`);
        }
      }
      opts.push('],');
      break;
    }
    case 'binary':
      opts.push(phpTodo(body.file));
      opts.push(`CURLOPT_POSTFIELDS => file_get_contents(${phpString(body.file.name)}),`);
      break;
  }

  const lines = ['<?php', '', '$curl = curl_init();', '', 'curl_setopt_array($curl, ['];
  lines.push(...opts.map(o => `    ${o}`), ']);', '');
  lines.push('$response = curl_exec($curl);', '');
  lines.push('if ($response === false) {', '    fwrite(STDERR, curl_error($curl) . PHP_EOL);', '    exit(1);', '}', '');
  lines.push('echo curl_getinfo($curl, CURLINFO_RESPONSE_CODE) . PHP_EOL;', 'echo $response . PHP_EOL;');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// C# HttpClient
// ---------------------------------------------------------------------------

/** Headers .NET only accepts on HttpContent.Headers. */
const CSHARP_CONTENT_HEADERS = new Set([
  'allow', 'content-disposition', 'content-encoding', 'content-language', 'content-length',
  'content-location', 'content-md5', 'content-range', 'content-type', 'expires', 'last-modified',
]);

const CSHARP_METHODS: Record<HttpMethod, string> = {
  GET: 'HttpMethod.Get',
  POST: 'HttpMethod.Post',
  PUT: 'HttpMethod.Put',
  PATCH: 'HttpMethod.Patch',
  DELETE: 'HttpMethod.Delete',
  HEAD: 'HttpMethod.Head',
  OPTIONS: 'HttpMethod.Options',
};

function csharpCode(req: ResolvedRequest): string {
  const { body } = req;
  const usings = new Set(['System', 'System.Net.Http']);
  const isContentHeader = ([name]: [string, string]) => CSHARP_CONTENT_HEADERS.has(name.toLowerCase());
  const contentHeaders = req.headers.filter(isContentHeader);
  const lines = [
    'using var client = new HttpClient();',
    `using var request = new HttpRequestMessage(${CSHARP_METHODS[req.method]}, ${csharpString(req.url)});`,
  ];
  for (const [name, value] of req.headers.filter(h => !isContentHeader(h))) {
    lines.push(`request.Headers.TryAddWithoutValidation(${csharpString(name)}, ${csharpString(value)});`);
  }

  let contentSetsType = false;
  switch (body.kind) {
    case 'none':
      if (contentHeaders.length > 0) lines.push('request.Content = new ByteArrayContent(Array.Empty<byte>());');
      break;
    case 'text':
      usings.add('System.Text');
      // ByteArrayContent adds no Content-Type of its own (StringContent would add text/plain).
      lines.push(`request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(${csharpString(body.text)}));`);
      break;
    case 'urlencoded':
      usings.add('System.Collections.Generic');
      lines.push('request.Content = new FormUrlEncodedContent(new List<KeyValuePair<string, string>>', '{');
      for (const [k, v] of body.fields) lines.push(`    new(${csharpString(k)}, ${csharpString(v)}),`);
      lines.push('});');
      contentSetsType = true;
      break;
    case 'multipart':
      lines.push('var form = new MultipartFormDataContent();');
      body.fields.forEach((field, i) => {
        if (field.file) {
          usings.add('System.IO');
          const f = field.file;
          lines.push(fileTodo(f, '//'));
          lines.push(`var file${i} = new StreamContent(File.OpenRead(${csharpString(f.name)}));`);
          lines.push(`file${i}.Headers.TryAddWithoutValidation("Content-Type", ${csharpString(partType(f))});`);
          lines.push(`form.Add(file${i}, ${csharpString(field.name)}, ${csharpString(f.name)});`);
        } else {
          lines.push(`form.Add(new StringContent(${csharpString(field.value ?? '')}), ${csharpString(field.name)});`);
        }
      });
      lines.push('request.Content = form;');
      contentSetsType = true;
      break;
    case 'binary':
      usings.add('System.IO');
      lines.push(fileTodo(body.file, '//'));
      lines.push(`request.Content = new StreamContent(File.OpenRead(${csharpString(body.file.name)}));`);
      break;
  }
  if (contentSetsType && hasHeader(contentHeaders, 'Content-Type')) {
    // Replace the Content-Type the content class chose with the one set explicitly.
    lines.push('request.Content.Headers.Remove("Content-Type");');
  }
  for (const [name, value] of contentHeaders) {
    lines.push(`request.Content.Headers.TryAddWithoutValidation(${csharpString(name)}, ${csharpString(value)});`);
  }

  lines.push('', 'using var response = await client.SendAsync(request);');
  lines.push('Console.WriteLine((int)response.StatusCode);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());');
  const sortedUsings = [...usings].sort((a, b) => (a === 'System' ? -1 : b === 'System' ? 1 : a.localeCompare(b)));
  return [...sortedUsings.map(u => `using ${u};`), '', ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// HTTPie
// ---------------------------------------------------------------------------

/** Characters HTTPie treats as item separators (and lets a backslash escape). */
const HTTPIE_SPECIAL = /[:;=@]/g;

/** An item key: escape separators. Undefined when HTTPie cannot represent it. */
function httpieKey(key: string): string | undefined {
  if (/\\(?=[:;=@]|$)/.test(key)) return undefined;
  return key.replace(HTTPIE_SPECIAL, c => `\\${c}`);
}

/**
 * An item value after its separator. Only a leading `=` or `@` needs escaping
 * (it would form a longer separator). Undefined when HTTPie would drop a backslash.
 */
function httpieValue(value: string): string | undefined {
  if (/\\[:;=@]/.test(value)) return undefined;
  return /^[=@]/.test(value) ? `\\${value}` : value;
}

function httpieItem(key: string, sep: string, value: string): string | undefined {
  const k = httpieKey(key);
  const v = sep === '@' ? (/\\[:;=@]/.test(value) ? undefined : value) : httpieValue(value);
  return k === undefined || v === undefined ? undefined : `${k}${sep}${v}`;
}

function httpieCode(req: ResolvedRequest): string {
  const { body } = req;
  const items: string[] = [];
  const flags: string[] = [];

  for (const [name, value] of req.headers) {
    // `Name;` is HTTPie's syntax for an empty header. Unrepresentable headers are passed through best-effort.
    const item = value === '' ? httpieItem(name, ';', '') : httpieItem(name, ':', value);
    items.push(shellQuote(item ?? `${name}:${value}`));
  }

  switch (body.kind) {
    case 'text':
      items.push(`--raw=${shellQuote(body.text)}`);
      break;
    case 'urlencoded': {
      const encoded = body.fields.map(([k, v]) => httpieItem(k, '=', v));
      if (encoded.every((item): item is string => item !== undefined)) {
        flags.push('--form');
        items.push(...encoded.map(shellQuote));
      } else {
        items.push(`--raw=${shellQuote(body.fields.map(([k, v]) => `${formUrlEncode(k)}=${formUrlEncode(v)}`).join('&'))}`);
      }
      break;
    }
    case 'multipart':
      flags.push('--multipart');
      for (const field of body.fields) {
        const item = field.file
          ? httpieItem(field.name, '@', `${field.file.name};type=${partType(field.file)}`)
          : httpieItem(field.name, '=', field.value ?? '');
        items.push(shellQuote(item ?? `${field.name}=${field.value ?? ''}`));
      }
      break;
    case 'binary':
      items.push(`< ${shellQuote(body.file.name)}`);
      break;
  }

  const first = ['http', ...flags, req.method, shellQuote(req.url)].join(' ');
  return [first, ...items].join(' \\\n  ');
}
