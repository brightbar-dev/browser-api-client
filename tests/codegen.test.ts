import { describe, it, expect } from 'vitest';
import {
  CODEGEN_TARGETS, generateCode, shellQuote, jsString, pythonString, goString, csharpString, phpString,
  formUrlEncode, toWellFormed, type CodegenTarget,
} from '../utils/codegen';
import type { FileRef, ResolvedBody, ResolvedRequest } from '../utils/request';

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const EMOJI = String.fromCodePoint(0x1f600);
const E_ACUTE = ch(0xe9);

/** Strings every literal helper must carry exactly. */
const HOSTILE: string[] = [
  '', 'plain', "it's", 'say "hi"', 'back\\slash', 'trailing\\', "\\'", "''", '$HOME $(id) ${x}',
  '`whoami`', 'line1\nline2', 'cr\r\nlf', 'tab\there', `caf${E_ACUTE}`, `${EMOJI} emoji`, '{{var}}',
  '100% %s %d', '{"a":"it\'s \\n \\"q\\""}', ch(0x2028, 0x2029), ch(0, 7, 0x1b, 0x7f, 0x85), `${ch(0xfeff)}bom`,
  'a?>b', '@file', '<file', '=lead', 'a\\=b',
];

const TEXT_BODY = `{"msg":"it's \\"q\\" \\n","cmd":"$HOME \`id\` {{v}} 100%"}\n\tsecond line\r\n${EMOJI}${E_ACUTE}${ch(0x2028)}`;

const PHOTO: FileRef = { id: 'f1', name: 'photo.png', size: 3, type: 'image/png' };

function request(overrides: Partial<ResolvedRequest> = {}): ResolvedRequest {
  return { method: 'GET', url: 'https://api.example.com/users', headers: [], body: { kind: 'none' }, ...overrides };
}

const JSON_POST = request({
  method: 'POST',
  url: 'https://api.example.com/users?page=2',
  headers: [['Content-Type', 'application/json'], ['Authorization', 'Bearer abc123']],
  body: { kind: 'text', text: '{"name":"Ada"}' },
});

const BODIES: ResolvedBody[] = [
  { kind: 'none' },
  { kind: 'text', text: TEXT_BODY },
  { kind: 'urlencoded', fields: [['b', '1'], ['a', '@2'], ['a', '3']] },
  { kind: 'multipart', fields: [{ name: 'note', value: '@x' }, { name: 'photo', file: PHOTO }, { name: 'doc', file: { ...PHOTO, name: 'b.pdf', type: '' } }] },
  { kind: 'binary', file: PHOTO },
];

// ---------------------------------------------------------------------------
// Independent decoders for each literal syntax
// ---------------------------------------------------------------------------

/** Decode a double-quoted literal that may use only \\ \" \n \r \t, \xHH (below xLimit) and \uHHHH. */
function decodeDoubleQuoted(lit: string, xLimit: number | null): string {
  expect(lit.length).toBeGreaterThanOrEqual(2);
  expect(lit.charAt(0)).toBe('"');
  expect(lit.charAt(lit.length - 1)).toBe('"');
  const body = lit.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body.charAt(i);
    const code = c.charCodeAt(0);
    if (c === '"') throw new Error(`unescaped quote in ${lit}`);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0xfeff) {
      throw new Error(`raw invisible character ${code} in ${lit}`);
    }
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = body.charAt(++i);
    if (e === '\\' || e === '"') out += e;
    else if (e === 'n') out += '\n';
    else if (e === 'r') out += '\r';
    else if (e === 't') out += '\t';
    else if (e === 'x' && xLimit !== null) {
      const h = body.slice(i + 1, i + 3);
      expect(h).toMatch(/^[0-9A-F]{2}$/);
      expect(parseInt(h, 16)).toBeLessThan(xLimit);
      out += ch(parseInt(h, 16));
      i += 2;
    } else if (e === 'u') {
      const h = body.slice(i + 1, i + 5);
      expect(h).toMatch(/^[0-9A-F]{4}$/);
      out += ch(parseInt(h, 16));
      i += 4;
    } else {
      throw new Error(`unexpected escape \\${e} in ${lit}`);
    }
  }
  return out;
}

/** Decode a PHP single-quoted string: only \\ and \' are escapes. */
function decodePhpSingle(lit: string): string {
  expect(lit.charAt(0)).toBe("'");
  expect(lit.charAt(lit.length - 1)).toBe("'");
  const body = lit.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body.charAt(i);
    if (c === "'") throw new Error(`unescaped quote in ${lit}`);
    const next = body.charAt(i + 1);
    if (c === '\\' && (next === '\\' || next === "'")) {
      out += next;
      i++;
    } else if (c === '\\' && i === body.length - 1) {
      throw new Error('a trailing backslash escapes the closing quote');
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Split a POSIX shell command into argv. Accepts only single-quoted text,
 * backslash escapes, backslash-newline continuations and plain safe words, so
 * any unquoted metacharacter or bare newline in generated output fails loudly.
 */
function shellWords(cmd: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd.charAt(i);
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      if (end < 0) throw new Error('unterminated single quote');
      word = (word ?? '') + cmd.slice(i + 1, end);
      i = end;
    } else if (c === '\\') {
      const next = cmd.charAt(i + 1);
      if (next === '') throw new Error('trailing backslash');
      i++;
      if (next !== '\n') word = (word ?? '') + next;
    } else if (c === ' ') {
      if (word !== null) words.push(word);
      word = null;
    } else if (c === '\n') {
      throw new Error(`bare newline at ${i} would end the command`);
    } else if (/[A-Za-z0-9_\-.,:/=@<+]/.test(c)) {
      word = (word ?? '') + c;
    } else {
      throw new Error(`unquoted shell metacharacter ${JSON.stringify(c)} at ${i}`);
    }
  }
  if (word !== null) words.push(word);
  return words;
}

const HTTPIE_SEPARATORS = [':', ';', ':@', '=', ':=', '@', '=@', ':=@', '==', '==@'];

/** Mirror of HTTPie 3.2.4 KeyValueArgType: backslash-escape tokens, then the first-found, longest separator. */
function httpieParse(item: string): { key: string; sep: string; value: string } {
  const special = new Set(HTTPIE_SEPARATORS.join('').split(''));
  const tokens: Array<{ text: string; escaped: boolean }> = [{ text: '', escaped: false }];
  const last = () => tokens[tokens.length - 1]!;
  for (let i = 0; i < item.length; i++) {
    const c = item.charAt(i);
    if (c !== '\\') {
      last().text += c;
      continue;
    }
    const next = item.charAt(++i);
    if (special.has(next)) tokens.push({ text: next, escaped: true }, { text: '', escaped: false });
    else last().text += `\\${next}`;
  }
  const bySize = [...HTTPIE_SEPARATORS].sort((a, b) => a.length - b.length);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.escaped) continue;
    const found = new Map<number, string>();
    for (const sep of bySize) {
      const pos = token.text.indexOf(sep);
      if (pos !== -1) found.set(pos, sep);
    }
    if (found.size === 0) continue;
    const pos = Math.min(...found.keys());
    const sep = found.get(pos)!;
    return {
      key: tokens.slice(0, i).map(t => t.text).join('') + token.text.slice(0, pos),
      sep,
      value: token.text.slice(pos + sep.length) + tokens.slice(i + 1).map(t => t.text).join(''),
    };
  }
  throw new Error(`not a valid HTTPie item: ${item}`);
}

function lineAfter(code: string, prefix: string): string {
  const line = code.split('\n').map(l => l.trimStart()).find(l => l.startsWith(prefix));
  if (line === undefined) throw new Error(`no line starting with ${prefix} in:\n${code}`);
  return line.slice(prefix.length);
}

// ---------------------------------------------------------------------------
// Target list
// ---------------------------------------------------------------------------

describe('CODEGEN_TARGETS', () => {
  it('lists the eight targets with their labels', () => {
    expect(CODEGEN_TARGETS).toEqual([
      { id: 'curl', label: 'cURL', language: 'shell' },
      { id: 'fetch', label: 'JavaScript fetch', language: 'javascript' },
      { id: 'axios', label: 'Node.js axios', language: 'javascript' },
      { id: 'python', label: 'Python requests', language: 'python' },
      { id: 'go', label: 'Go net/http', language: 'go' },
      { id: 'php', label: 'PHP cURL', language: 'php' },
      { id: 'csharp', label: 'C# HttpClient', language: 'csharp' },
      { id: 'httpie', label: 'HTTPie', language: 'shell' },
    ]);
  });

  it('generates deterministic output for every target and body kind', () => {
    for (const { id } of CODEGEN_TARGETS) {
      for (const body of BODIES) {
        const req = request({ method: 'POST', headers: [['X-A', '1']], body });
        const code = generateCode(id, req);
        expect(code.length).toBeGreaterThan(0);
        expect(generateCode(id, req)).toBe(code);
      }
    }
  });

  it('never emits a lone surrogate or raw U+2028 outside shell/PHP text', () => {
    const req = request({
      method: 'POST',
      headers: [['X-Bad', `a${ch(0xd800)}b`]],
      body: { kind: 'text', text: `x${ch(0xdc00)}${ch(0x2028)}y` },
    });
    for (const { id } of CODEGEN_TARGETS) {
      const code = generateCode(id, req);
      expect(code).not.toMatch(/[\uD800-\uDFFF]/);
      if (id !== 'curl' && id !== 'httpie' && id !== 'php') expect(code).not.toContain(ch(0x2028));
    }
  });
});

// ---------------------------------------------------------------------------
// Literal helpers
// ---------------------------------------------------------------------------

describe('toWellFormed', () => {
  it('replaces unpaired surrogates and keeps pairs', () => {
    expect(toWellFormed(`a${ch(0xd800)}b${ch(0xdc00)}c${EMOJI}`)).toBe(`a${ch(0xfffd)}b${ch(0xfffd)}c${EMOJI}`);
  });
});

describe('shellQuote', () => {
  it('uses POSIX single-quote escaping', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('$HOME `id` "x" \\')).toBe("'$HOME `id` \"x\" \\'");
    expect(shellQuote('')).toBe("''");
  });

  it('round-trips hostile strings through a shell word parser', () => {
    for (const s of HOSTILE) expect(shellWords(`cmd ${shellQuote(s)}`)).toEqual(['cmd', s]);
  });
});

describe('jsString', () => {
  it('round-trips hostile strings', () => {
    for (const s of HOSTILE) expect(JSON.parse(jsString(s))).toBe(s);
  });

  it('escapes line separators and invisible characters', () => {
    expect(jsString(ch(0x2028, 0xfeff))).toBe('"\\u2028\\uFEFF"');
    expect(jsString("it's `x` ${y}")).toBe('"it\'s `x` ${y}"');
  });
});

describe('pythonString', () => {
  it('round-trips hostile strings', () => {
    for (const s of HOSTILE) expect(decodeDoubleQuoted(pythonString(s), 0x100)).toBe(s);
  });

  it('escapes quotes, backslashes and controls, keeps unicode readable', () => {
    expect(pythonString(`a"b\\c\n\t${E_ACUTE}${EMOJI}`)).toBe(`"a\\"b\\\\c\\n\\t${E_ACUTE}${EMOJI}"`);
    expect(pythonString(ch(0, 0x85, 0x2028))).toBe('"\\x00\\x85\\u2028"');
    expect(pythonString("{'x'}")).toBe('"{\'x\'}"');
  });
});

describe('goString', () => {
  it('round-trips hostile strings with ASCII-only \\x escapes', () => {
    for (const s of HOSTILE) expect(decodeDoubleQuoted(goString(s), 0x80)).toBe(s);
  });

  it('keeps backticks and percent signs literal, escapes C1 as \\u', () => {
    expect(goString('`%s`')).toBe('"`%s`"');
    expect(goString(ch(0x1b, 0x85))).toBe('"\\x1B\\u0085"');
  });
});

describe('csharpString', () => {
  it('round-trips hostile strings without \\x escapes', () => {
    for (const s of HOSTILE) expect(decodeDoubleQuoted(csharpString(s), null)).toBe(s);
  });

  it('uses fixed-width \\u escapes', () => {
    expect(csharpString(`${ch(0)}1{x}`)).toBe('"\\u00001{x}"');
  });
});

describe('phpString', () => {
  it('escapes only backslash and single quote', () => {
    expect(phpString("it's \\ $x {$y} \"z\"")).toBe("'it\\'s \\\\ $x {$y} \"z\"'");
    expect(phpString('trailing\\')).toBe("'trailing\\\\'");
  });

  it('round-trips hostile strings', () => {
    for (const s of HOSTILE) expect(decodePhpSingle(phpString(s))).toBe(s);
  });
});

describe('formUrlEncode', () => {
  it('matches URLSearchParams byte for byte', () => {
    for (const s of HOSTILE) {
      expect(`${formUrlEncode(s)}=${formUrlEncode(s)}`).toBe(new URLSearchParams([[s, s]]).toString());
    }
  });
});

// ---------------------------------------------------------------------------
// curl
// ---------------------------------------------------------------------------

describe('curl', () => {
  const argv = (req: ResolvedRequest) => shellWords(generateCode('curl', req));

  it('matches the reference output for a JSON POST', () => {
    expect(generateCode('curl', JSON_POST)).toBe([
      "curl -X POST 'https://api.example.com/users?page=2' \\",
      "  -H 'Content-Type: application/json' \\",
      "  -H 'Authorization: Bearer abc123' \\",
      "  --data-raw '{\"name\":\"Ada\"}'",
    ].join('\n'));
  });

  it('omits -X for GET, uses --head for HEAD and -X for everything else', () => {
    expect(argv(request())).toEqual(['curl', 'https://api.example.com/users']);
    expect(argv(request({ method: 'HEAD' }))).toEqual(['curl', '--head', 'https://api.example.com/users']);
    expect(argv(request({ method: 'DELETE' }))).toEqual(['curl', '-X', 'DELETE', 'https://api.example.com/users']);
    expect(argv(request({ method: 'OPTIONS' }))).toEqual(['curl', '-X', 'OPTIONS', 'https://api.example.com/users']);
  });

  it('keeps the method when a body would otherwise change it', () => {
    const body: ResolvedBody = { kind: 'text', text: 'x' };
    expect(argv(request({ body })).slice(0, 3)).toEqual(['curl', '-X', 'GET']);
    expect(argv(request({ method: 'HEAD', body })).slice(0, 3)).toEqual(['curl', '-X', 'HEAD']);
  });

  it('turns off URL globbing when the URL has braces or brackets', () => {
    expect(argv(request({ url: 'https://x.test/?q={{v}}' }))).toEqual(['curl', '--globoff', 'https://x.test/?q={{v}}']);
    expect(argv(request({ url: 'https://x.test/?a[]=1' }))).toContain('--globoff');
    expect(argv(request())).not.toContain('--globoff');
  });

  it('passes hostile header values exactly and sends empty headers with ;', () => {
    const headers: Array<[string, string]> = HOSTILE.filter(Boolean).map(v => ['X-Test', v]);
    const words = argv(request({ headers: [...headers, ['X-Empty', '']] }));
    const values = words.filter((_, i) => words[i - 1] === '-H');
    expect(values).toEqual([...headers.map(([n, v]) => `${n}: ${v}`), 'X-Empty;']);
  });

  it('sends text bodies with --data-raw so a leading @ is not a file', () => {
    expect(argv(request({ method: 'POST', body: { kind: 'text', text: TEXT_BODY } })).slice(-2)).toEqual(['--data-raw', TEXT_BODY]);
    expect(argv(request({ method: 'POST', body: { kind: 'text', text: '@/etc/passwd' } })).slice(-2)).toEqual(['--data-raw', '@/etc/passwd']);
  });

  it('url-encodes each form field, pre-encoding names', () => {
    const words = argv(request({ method: 'POST', body: { kind: 'urlencoded', fields: [['a b', "it's & = @x"], ['', 'e']] } }));
    expect(words.slice(-4)).toEqual(['--data-urlencode', "a+b=it's & = @x", '--data-raw', '=e']);
  });

  it('uses -F for simple values and files, --form-string for values curl would reinterpret', () => {
    const fields = [
      { name: 'simple', value: 'hello world' },
      { name: 'at', value: '@notafile' },
      { name: 'lt', value: '<notafile' },
      { name: 'semi', value: 'a;type=text/html' },
      { name: 'quoted', value: '"q"' },
      { name: 'pad', value: ' x ' },
      { name: 'empty', value: '' },
      { name: 'photo', file: PHOTO },
      { name: 'odd', file: { ...PHOTO, name: 'my "a;b".png', type: '' } },
      { name: 'charset', file: { ...PHOTO, name: 'n.txt', type: 'text/plain; charset=utf-8' } },
    ];
    const words = argv(request({ method: 'POST', body: { kind: 'multipart', fields } }));
    expect(words.slice(4)).toEqual([
      '-F', 'simple=hello world',
      '--form-string', 'at=@notafile',
      '--form-string', 'lt=<notafile',
      '--form-string', 'semi=a;type=text/html',
      '--form-string', 'quoted="q"',
      '--form-string', 'pad= x ',
      '-F', 'empty=',
      '-F', 'photo=@photo.png;type=image/png',
      '-F', 'odd=@"my \\"a;b\\".png";type=application/octet-stream',
      '-F', 'charset=@n.txt',
    ]);
  });

  it('sends binary files with --data-binary, never reading stdin', () => {
    expect(argv(request({ method: 'PUT', body: { kind: 'binary', file: PHOTO } })).slice(-2)).toEqual(['--data-binary', '@photo.png']);
    expect(argv(request({ method: 'PUT', body: { kind: 'binary', file: { ...PHOTO, name: '-' } } })).slice(-1)).toEqual(['@./-']);
  });
});

// ---------------------------------------------------------------------------
// JavaScript
// ---------------------------------------------------------------------------

describe('fetch', () => {
  it('matches the reference output for a JSON POST', () => {
    expect(generateCode('fetch', JSON_POST)).toBe([
      'const response = await fetch("https://api.example.com/users?page=2", {',
      '  method: "POST",',
      '  headers: {',
      '    "Content-Type": "application/json",',
      '    "Authorization": "Bearer abc123",',
      '  },',
      '  body: "{\\"name\\":\\"Ada\\"}",',
      '});',
      '',
      'console.log(response.status);',
      'console.log(await response.text());',
    ].join('\n'));
  });

  it('sends the exact body text as a string literal', () => {
    const code = generateCode('fetch', request({ method: 'POST', body: { kind: 'text', text: TEXT_BODY } }));
    expect(JSON.parse(lineAfter(code, 'body: ').replace(/,$/, ''))).toBe(TEXT_BODY);
  });

  it('switches headers to an array when a name repeats', () => {
    const code = generateCode('fetch', request({ headers: [['X-A', '1'], ['x-a', '2']] }));
    expect(code).toContain('  headers: [\n    ["X-A", "1"],\n    ["x-a", "2"],\n  ],');
  });

  it('encodes form bodies with URLSearchParams pairs, keeping order and repeats', () => {
    const code = generateCode('fetch', request({ method: 'POST', body: { kind: 'urlencoded', fields: [['b', '1'], ['a', '2'], ['b', '3']] } }));
    expect(code).toContain('  body: new URLSearchParams([\n    ["b", "1"],\n    ["a", "2"],\n    ["b", "3"],\n  ]),');
  });

  it('builds FormData with a marked placeholder for each file', () => {
    const code = generateCode('fetch', request({ method: 'POST', body: BODIES[3]! }));
    expect(code).toContain('form.append("note", "@x");');
    expect(code).toContain('// TODO: choose "photo.png"');
    expect(code).toContain('form.append("photo", new Blob([], { type: "image/png" }), "photo.png");');
    expect(code).toContain('form.append("doc", new Blob([], { type: "application/octet-stream" }), "b.pdf");');
    expect(code).toContain('  body: form,');
  });

  it('keeps a hostile file name out of the comment syntax', () => {
    const code = generateCode('fetch', request({ method: 'POST', body: { kind: 'binary', file: { ...PHOTO, name: `a\nb${ch(0x2028)}c` } } }));
    expect(code).toContain('// TODO: choose "a\\nb\\u2028c"');
  });
});

describe('axios', () => {
  it('matches the reference output for a JSON POST', () => {
    expect(generateCode('axios', JSON_POST)).toBe([
      'import axios from "axios";',
      '',
      'const response = await axios({',
      '  method: "POST",',
      '  url: "https://api.example.com/users?page=2",',
      '  headers: {',
      '    "Content-Type": "application/json",',
      '    "Authorization": "Bearer abc123",',
      '  },',
      '  data: "{\\"name\\":\\"Ada\\"}",',
      '  // Send the text as-is; axios would otherwise trim or re-serialize JSON.',
      '  transformRequest: [(data) => data],',
      '  // Resolve for every status instead of throwing on 4xx/5xx.',
      '  validateStatus: () => true,',
      '});',
      '',
      'console.log(response.status);',
      'console.log(response.data);',
    ].join('\n'));
  });

  it('sends repeated header names as an array value', () => {
    expect(generateCode('axios', request({ headers: [['X-A', '1'], ['x-a', '2']] }))).toContain('    "X-A": ["1", "2"],');
  });

  it('reads files from disk for multipart and binary, importing readFileSync once', () => {
    const multipart = generateCode('axios', request({ method: 'POST', body: BODIES[3]! }));
    expect(multipart.match(/import \{ readFileSync \}/g)).toHaveLength(1);
    expect(multipart).toContain('form.append("photo", new Blob([readFileSync("photo.png")], { type: "image/png" }), "photo.png");');
    expect(multipart).not.toContain('transformRequest');
    const binary = generateCode('axios', request({ method: 'POST', body: BODIES[4]! }));
    expect(binary).toContain('const file = readFileSync("photo.png");');
    expect(binary).toContain('  data: file,');
  });
});

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe('python', () => {
  it('matches the reference output for a JSON POST', () => {
    expect(generateCode('python', JSON_POST)).toBe([
      'import requests',
      '',
      'url = "https://api.example.com/users?page=2"',
      'headers = {',
      '    "Content-Type": "application/json",',
      '    "Authorization": "Bearer abc123",',
      '}',
      'payload = "{\\"name\\":\\"Ada\\"}"',
      '',
      'response = requests.request("POST", url, headers=headers, data=payload.encode("utf-8"))',
      '',
      'print(response.status_code)',
      'print(response.text)',
    ].join('\n'));
  });

  it('sends the exact JSON text, never a dict', () => {
    const code = generateCode('python', request({ method: 'POST', body: { kind: 'text', text: '{"ok":true,"v":null}' } }));
    expect(decodeDoubleQuoted(lineAfter(code, 'payload = '), 0x100)).toBe('{"ok":true,"v":null}');
    expect(code).not.toContain('json=');
    const hostile = generateCode('python', request({ method: 'POST', body: { kind: 'text', text: TEXT_BODY } }));
    expect(decodeDoubleQuoted(lineAfter(hostile, 'payload = '), 0x100)).toBe(TEXT_BODY);
  });

  it('uses a dict for unique form fields and a list of tuples when names repeat', () => {
    expect(generateCode('python', request({ method: 'POST', body: { kind: 'urlencoded', fields: [['a', '1'], ['b', '2']] } })))
      .toContain('data = {\n    "a": "1",\n    "b": "2",\n}');
    expect(generateCode('python', request({ method: 'POST', body: BODIES[2]! })))
      .toContain('data = [\n    ("b", "1"),\n    ("a", "@2"),\n    ("a", "3"),\n]');
  });

  it('keeps multipart order in one files list', () => {
    const code = generateCode('python', request({ method: 'POST', body: BODIES[3]! }));
    expect(code).toContain([
      'files = [',
      '    ("note", (None, "@x")),',
      '    # TODO: choose "photo.png"',
      '    ("photo", ("photo.png", open("photo.png", "rb"), "image/png")),',
      '    # TODO: choose "b.pdf"',
      '    ("doc", ("b.pdf", open("b.pdf", "rb"), "application/octet-stream")),',
      ']',
    ].join('\n'));
    expect(code).toContain('requests.request("POST", url, files=files)');
  });

  it('streams binary files and joins repeated header values', () => {
    const code = generateCode('python', request({ method: 'PUT', headers: [['X-A', '1'], ['x-a', '2']], body: BODIES[4]! }));
    expect(code).toContain('data = open("photo.png", "rb")');
    expect(code).toContain('    "X-A": "1, 2",');
  });
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

describe('go', () => {
  it('matches the reference output for a JSON POST', () => {
    expect(generateCode('go', JSON_POST)).toBe([
      'package main',
      '',
      'import (',
      '\t"fmt"',
      '\t"io"',
      '\t"net/http"',
      '\t"strings"',
      ')',
      '',
      'func main() {',
      '\tbody := strings.NewReader("{\\"name\\":\\"Ada\\"}")',
      '',
      '\treq, err := http.NewRequest("POST", "https://api.example.com/users?page=2", body)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\treq.Header.Add("Content-Type", "application/json")',
      '\treq.Header.Add("Authorization", "Bearer abc123")',
      '',
      '\tres, err := http.DefaultClient.Do(req)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tdefer res.Body.Close()',
      '',
      '\tresBody, err := io.ReadAll(res.Body)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '',
      '\tfmt.Println(res.Status)',
      '\tfmt.Println(string(resBody))',
      '}',
    ].join('\n'));
  });

  it('imports exactly the packages each body kind uses', () => {
    for (const body of BODIES) {
      const code = generateCode('go', request({ method: 'POST', body }));
      const imports = [...code.matchAll(/^\t"([a-z/]+)"$/gm)].map(m => m[1]!);
      const names = imports.map(p => p.split('/').pop()!);
      const main = code.slice(code.indexOf('func main()'));
      for (const name of names) expect(main, `${body.kind} imports unused ${name}`).toContain(`${name}.`);
      for (const used of new Set([...main.matchAll(/\b(bytes|fmt|io|multipart|http|url|textproto|os|strings)\./g)].map(m => m[1]!))) {
        expect(names, `${body.kind} uses ${used} without importing it`).toContain(used);
      }
      expect(imports).toEqual([...imports].sort());
    }
  });

  it('sends the exact body text', () => {
    const code = generateCode('go', request({ method: 'POST', body: { kind: 'text', text: TEXT_BODY } }));
    expect(decodeDoubleQuoted(lineAfter(code, 'body := strings.NewReader(').replace(/\)$/, ''), 0x80)).toBe(TEXT_BODY);
  });

  it('uses url.Values when its key sort keeps the order, else joins by hand', () => {
    const sorted = generateCode('go', request({ method: 'POST', body: { kind: 'urlencoded', fields: [['a', '1'], ['a', '0'], ['b', '2']] } }));
    expect(sorted).toContain('\tform := url.Values{}\n\tform.Add("a", "1")\n\tform.Add("a", "0")\n\tform.Add("b", "2")\n\tbody := strings.NewReader(form.Encode())');
    const unsorted = generateCode('go', request({ method: 'POST', body: BODIES[2]! }));
    expect(unsorted).toContain('\t\turl.QueryEscape("b") + "=" + url.QueryEscape("1"),\n\t\turl.QueryEscape("a") + "=" + url.QueryEscape("@2"),');
    expect(unsorted).not.toContain('url.Values{}');
  });

  it('writes multipart parts with their content types and sets the boundary header', () => {
    const code = generateCode('go', request({ method: 'POST', body: BODIES[3]! }));
    expect(code).toContain('\tif err := form.WriteField("note", "@x"); err != nil {');
    expect(code).toContain('\tpart1Header.Set("Content-Disposition", "form-data; name=\\"photo\\"; filename=\\"photo.png\\"")');
    expect(code).toContain('\tpart1Header.Set("Content-Type", "image/png")');
    expect(code).toContain('\treq.Header.Set("Content-Type", form.FormDataContentType())');
    const explicit = generateCode('go', request({ method: 'POST', headers: [['Content-Type', 'multipart/form-data']], body: BODIES[3]! }));
    expect(explicit).not.toContain('FormDataContentType');
  });

  it('sets req.Host for a Host header', () => {
    expect(generateCode('go', request({ headers: [['Host', 'example.org']] }))).toContain('\treq.Host = "example.org"');
  });
});

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

describe('php', () => {
  it('matches the reference output for a JSON POST', () => {
    expect(generateCode('php', JSON_POST)).toBe([
      '<?php',
      '',
      '$curl = curl_init();',
      '',
      'curl_setopt_array($curl, [',
      "    CURLOPT_URL => 'https://api.example.com/users?page=2',",
      '    CURLOPT_RETURNTRANSFER => true,',
      "    CURLOPT_CUSTOMREQUEST => 'POST',",
      '    CURLOPT_HTTPHEADER => [',
      "        'Content-Type: application/json',",
      "        'Authorization: Bearer abc123',",
      '    ],',
      "    CURLOPT_POSTFIELDS => '{\"name\":\"Ada\"}',",
      ']);',
      '',
      '$response = curl_exec($curl);',
      '',
      'if ($response === false) {',
      '    fwrite(STDERR, curl_error($curl) . PHP_EOL);',
      '    exit(1);',
      '}',
      '',
      'echo curl_getinfo($curl, CURLINFO_RESPONSE_CODE) . PHP_EOL;',
      'echo $response . PHP_EOL;',
    ].join('\n'));
  });

  it('sends the exact body text', () => {
    const code = generateCode('php', request({ method: 'POST', body: { kind: 'text', text: TEXT_BODY } }));
    const m = /CURLOPT_POSTFIELDS => ('(?:[^'\\]|\\.)*'),\n/.exec(code);
    expect(decodePhpSingle(m![1]!)).toBe(TEXT_BODY);
  });

  it('picks the method option: none for GET, NOBODY for HEAD', () => {
    expect(generateCode('php', request())).not.toContain('CUSTOMREQUEST');
    const head = generateCode('php', request({ method: 'HEAD' }));
    expect(head).toContain('CURLOPT_NOBODY => true,');
    expect(head).not.toContain('CUSTOMREQUEST');
    expect(generateCode('php', request({ headers: [['X-Empty', '']] }))).toContain("        'X-Empty;',");
  });

  it('uses http_build_query for unique form names and per-pair encoding when names repeat', () => {
    expect(generateCode('php', request({ method: 'POST', body: { kind: 'urlencoded', fields: [['a', "it's"]] } })))
      .toContain("    CURLOPT_POSTFIELDS => http_build_query([\n        'a' => 'it\\'s',\n    ], '', '&'),");
    expect(generateCode('php', request({ method: 'POST', body: BODIES[2]! })))
      .toContain("        urlencode('a') . '=' . urlencode('3'),\n    ]),");
  });

  it('uploads files with CURLFile and flags repeated multipart names', () => {
    const code = generateCode('php', request({
      method: 'POST',
      body: { kind: 'multipart', fields: [{ name: 'a', value: '@x' }, { name: 'a', value: 'y' }, { name: 'photo', file: { ...PHOTO, name: 'x?>y.png' } }] },
    }));
    expect(code).toContain("        'a' => '@x',");
    expect(code).toContain('        // NOTE: PHP arrays cannot repeat a key; only the last "a" is sent.');
    expect(code).toContain('        // TODO: choose "x?\\>y.png"');
    expect(code).toContain("        'photo' => new CURLFile('x?>y.png', 'image/png', 'x?>y.png'),");
    expect(generateCode('php', request({ method: 'POST', body: BODIES[4]! }))).toContain("    CURLOPT_POSTFIELDS => file_get_contents('photo.png'),");
  });
});

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

describe('csharp', () => {
  it('matches the reference output for a JSON POST', () => {
    expect(generateCode('csharp', JSON_POST)).toBe([
      'using System;',
      'using System.Net.Http;',
      'using System.Text;',
      '',
      'using var client = new HttpClient();',
      'using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.example.com/users?page=2");',
      'request.Headers.TryAddWithoutValidation("Authorization", "Bearer abc123");',
      'request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes("{\\"name\\":\\"Ada\\"}"));',
      'request.Content.Headers.TryAddWithoutValidation("Content-Type", "application/json");',
      '',
      'using var response = await client.SendAsync(request);',
      'Console.WriteLine((int)response.StatusCode);',
      'Console.WriteLine(await response.Content.ReadAsStringAsync());',
    ].join('\n'));
  });

  it('sends the exact body text', () => {
    const code = generateCode('csharp', request({ method: 'POST', body: { kind: 'text', text: TEXT_BODY } }));
    const lit = lineAfter(code, 'request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(').replace(/\)\);$/, '');
    expect(decodeDoubleQuoted(lit, null)).toBe(TEXT_BODY);
  });

  it('maps every method', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
    for (const method of methods) {
      const name = method.charAt(0) + method.slice(1).toLowerCase();
      expect(generateCode('csharp', request({ method }))).toContain(`new HttpRequestMessage(HttpMethod.${name}, `);
    }
  });

  it('routes content headers to the content and replaces a content class type', () => {
    const form = generateCode('csharp', request({
      method: 'POST',
      headers: [['Content-Type', 'application/x-www-form-urlencoded'], ['X-A', '1']],
      body: BODIES[2]!,
    }));
    expect(form).toContain('request.Headers.TryAddWithoutValidation("X-A", "1");');
    expect(form).toContain('    new("a", "@2"),');
    expect(form).toContain('request.Content.Headers.Remove("Content-Type");\nrequest.Content.Headers.TryAddWithoutValidation("Content-Type", "application/x-www-form-urlencoded");');
    const bare = generateCode('csharp', request({ headers: [['Content-Language', 'en']] }));
    expect(bare).toContain('request.Content = new ByteArrayContent(Array.Empty<byte>());');
  });

  it('streams files for multipart and binary bodies', () => {
    const code = generateCode('csharp', request({ method: 'POST', body: BODIES[3]! }));
    expect(code).toContain('using System.IO;');
    expect(code).toContain('form.Add(new StringContent("@x"), "note");');
    expect(code).toContain('var file1 = new StreamContent(File.OpenRead("photo.png"));\nfile1.Headers.TryAddWithoutValidation("Content-Type", "image/png");\nform.Add(file1, "photo", "photo.png");');
    expect(code).not.toContain('Remove("Content-Type")');
    expect(generateCode('csharp', request({ method: 'POST', body: BODIES[4]! }))).toContain('request.Content = new StreamContent(File.OpenRead("photo.png"));');
  });
});

// ---------------------------------------------------------------------------
// HTTPie
// ---------------------------------------------------------------------------

describe('httpie', () => {
  const argv = (req: ResolvedRequest) => shellWords(generateCode('httpie', req));

  it('matches the reference output for a JSON POST', () => {
    expect(generateCode('httpie', JSON_POST)).toBe([
      "http POST 'https://api.example.com/users?page=2' \\",
      "  'Content-Type:application/json' \\",
      "  'Authorization:Bearer abc123' \\",
      "  --raw='{\"name\":\"Ada\"}'",
    ].join('\n'));
  });

  it('writes header items HTTPie parses back to the exact name and value', () => {
    const values = ['it\'s "q" $HOME `id` {{v}} 100%', '=starts', '@starts', ':=@x', 'a;b', 'back\\slash', 'trailing\\', 'x==y'];
    const words = argv(request({ headers: [...values.map((v): [string, string] => ['X-Test', v]), ['X-Empty', '']] }));
    const items = words.slice(3);
    values.forEach((v, i) => expect(httpieParse(items[i]!)).toEqual({ key: 'X-Test', sep: ':', value: v }));
    expect(httpieParse(items[values.length]!)).toEqual({ key: 'X-Empty', sep: ';', value: '' });
  });

  it('sends text bodies with --raw', () => {
    expect(argv(request({ method: 'POST', body: { kind: 'text', text: TEXT_BODY } })).slice(-1)).toEqual([`--raw=${TEXT_BODY}`]);
  });

  it('sends form fields as --form items, escaping separators', () => {
    const fields: Array<[string, string]> = [['a:b=c@d;e', '=lead'], ['at', '@file'], ['plain', "it's & = ok"], ['', 'e']];
    const words = argv(request({ method: 'POST', body: { kind: 'urlencoded', fields } }));
    expect(words.slice(0, 3)).toEqual(['http', '--form', 'POST']);
    expect(words.slice(4).map(httpieParse)).toEqual(fields.map(([key, value]) => ({ key, sep: '=', value })));
  });

  it('falls back to a pre-encoded --raw body when an item would lose a backslash', () => {
    const words = argv(request({ method: 'POST', body: { kind: 'urlencoded', fields: [['k', 'a\\=b'], ['z', '1']] } }));
    expect(words).not.toContain('--form');
    expect(words.slice(-1)).toEqual(['--raw=k=a%5C%3Db&z=1']);
  });

  it('sends multipart text and file items', () => {
    const words = argv(request({ method: 'POST', body: BODIES[3]! }));
    expect(words.slice(0, 3)).toEqual(['http', '--multipart', 'POST']);
    expect(words.slice(4).map(httpieParse)).toEqual([
      { key: 'note', sep: '=', value: '@x' },
      { key: 'photo', sep: '@', value: 'photo.png;type=image/png' },
      { key: 'doc', sep: '@', value: 'b.pdf;type=application/octet-stream' },
    ]);
  });

  it('redirects a binary file to stdin', () => {
    expect(argv(request({ method: 'PUT', body: BODIES[4]! }))).toEqual(['http', 'PUT', 'https://api.example.com/users', '<', 'photo.png']);
  });
});

describe('multipart newlines', () => {
  const req = request({ method: 'POST', body: { kind: 'multipart', fields: [{ name: 'note', value: 'a\nb\rc\r\nd' }] } });
  const CRLF_VALUE = 'a\r\nb\r\nc\r\nd';

  it('gives non-FormData targets the CRLF text the extension\'s FormData sends', () => {
    expect(shellWords(generateCode('curl', req)).slice(-2)).toEqual(['--form-string', `note=${CRLF_VALUE}`]);
    expect(generateCode('python', req)).toContain(`    ("note", (None, ${pythonString(CRLF_VALUE)})),`);
    expect(generateCode('go', req)).toContain(`form.WriteField("note", ${goString(CRLF_VALUE)})`);
    expect(generateCode('php', req)).toContain(`        'note' => ${phpString(CRLF_VALUE)},`);
    expect(generateCode('csharp', req)).toContain(`form.Add(new StringContent(${csharpString(CRLF_VALUE)}), "note");`);
    expect(httpieParse(shellWords(generateCode('httpie', req)).slice(-1)[0]!)).toEqual({ key: 'note', sep: '=', value: CRLF_VALUE });
  });

  it('leaves fetch and axios values as written, since FormData normalizes them when sending', () => {
    expect(generateCode('fetch', req)).toContain('form.append("note", "a\\nb\\rc\\r\\nd");');
    expect(generateCode('axios', req)).toContain('form.append("note", "a\\nb\\rc\\r\\nd");');
  });
});

// Every target handles every body kind without throwing for every method.
describe('coverage', () => {
  it('generates for all method x body x target combinations', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
    let count = 0;
    for (const method of methods) {
      for (const body of BODIES) {
        for (const { id } of CODEGEN_TARGETS) {
          expect(generateCode(id as CodegenTarget, request({ method, body })).length).toBeGreaterThan(0);
          count++;
        }
      }
    }
    expect(count).toBe(7 * 5 * 8);
  });
});
