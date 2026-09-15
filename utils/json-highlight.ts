/** Split JSON text into tokens for syntax colouring. Never throws; unknown text passes through. */

export type JsonTokenType = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'plain';

export interface JsonToken {
  type: JsonTokenType;
  text: string;
}

const TOKEN_RE = /("(?:[^"\\\n]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|([^"\d{}[\],:tfn-]+|.)/g;

export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const push = (type: JsonTokenType, value: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === type && (type === 'plain' || type === 'punct')) last.text += value;
    else tokens.push({ type, text: value });
  };
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        push('key', m[1]);
        push('punct', m[2]);
      } else {
        push('string', m[1]);
      }
    } else if (m[3] !== undefined) push('number', m[3]);
    else if (m[4] !== undefined) push('literal', m[4]);
    else if (m[5] !== undefined) push('punct', m[5]);
    else push('plain', m[0]);
  }
  return tokens;
}
