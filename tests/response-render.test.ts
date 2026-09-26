import { describe, expect, it } from 'vitest';
import { tokenizeJson } from '../utils/json-highlight';
import { reasonPhrase, statusLabel } from '../utils/http-status';

// The response pane runs both on every response: the status line and the pretty JSON view.

describe('tokenizeJson', () => {
  it('tells keys from string values, and types numbers and literals', () => {
    const tokens = tokenizeJson('{"id": 42, "name": "a:b", "ok": true, "x": null, "n": -1.5e3}');
    const of = (type: string) => tokens.filter((t) => t.type === type).map((t) => t.text);
    expect(of('key')).toEqual(['"id"', '"name"', '"ok"', '"x"', '"n"']);
    expect(of('string')).toEqual(['"a:b"']);
    expect(of('number')).toEqual(['42', '-1.5e3']);
    expect(of('literal')).toEqual(['true', 'null']);
  });

  it('never loses or reorders text, whatever the input', () => {
    for (const text of [
      '{"a": [1, 2, {"b": "c\\"d"}]}',
      '{\n  "unterminated": "abc\n}',
      'not json at all — trueish nullable 12abc',
      '',
      '{"emoji": "😀", "esc": "\\u00e9\\\\"}',
    ]) {
      expect(tokenizeJson(text).map((t) => t.text).join('')).toBe(text);
    }
  });

  it('keeps an escaped quote inside the string it belongs to', () => {
    expect(tokenizeJson('"say \\"hi\\""')).toEqual([{ type: 'string', text: '"say \\"hi\\""' }]);
  });

  it('can be called again after a previous run (the shared regex is reset)', () => {
    const first = tokenizeJson('{"a":1}');
    expect(tokenizeJson('{"a":1}')).toEqual(first);
  });
});

describe('statusLabel', () => {
  it('uses the server’s reason phrase when there is one', () => {
    expect(statusLabel(200, 'Everything Fine')).toBe('200 Everything Fine');
  });

  it('fills in the standard phrase for HTTP/2 responses that carry none', () => {
    expect(statusLabel(404, '')).toBe('404 Not Found');
    expect(statusLabel(422, '')).toBe('422 Unprocessable Content');
  });

  it('shows the bare code for a status it does not know', () => {
    expect(reasonPhrase(599)).toBe('');
    expect(statusLabel(599, '')).toBe('599');
  });
});
