/**
 * A safe JSONPath subset for reading values out of JSON responses.
 *
 * Supported syntax:
 * - `$` is the root. It is optional: `data.items[0]` means `$.data.items[0]`.
 * - `.key`, `['key']`, `["key"]` select an object member. Quoted keys accept
 *   JSON-style escapes (`\'`, `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX`).
 *   Unquoted keys may contain anything except `. [ ] ( ) ' " , * ?` and whitespace,
 *   so `$.$ref`, `$.@type` and `$.content-type` work.
 * - `[0]`, `[-1]` select an array element; a negative index counts from the end.
 * - `[*]`, `.*` select every array element or every object member value.
 * - `..key`, `..['key']`, `..*`, `..[*]` are recursive descent: every member named
 *   `key` (or every value) at any depth below the current node.
 *
 * Conveniences beyond standard JSONPath:
 * - `.length` is an ordinary member lookup, but on an array or a string (which have
 *   no JSON members) it resolves to the element or UTF-16 character count. An object
 *   with its own `length` member returns that member; an object without one does not
 *   match. Only direct `.length` / `['length']` gets this; `..length` does not.
 * - `.0` on an array is the same as `[0]` (non-negative integers only).
 *
 * Not supported, and rejected with an error: filter expressions `[?(...)]`, script
 * expressions `[(...)]`, unions `[a,b]`, slices `[0:2]`, and index selectors after
 * `..`. Nothing here evaluates code.
 *
 * Results are in document order (a node before its descendants, members in key
 * order, elements in index order).
 *
 * Limits, so hostile JSON cannot hang the UI:
 * - at most {@link MAX_RESULTS} results per step; further matches are dropped;
 * - recursive descent does not go deeper than {@link MAX_DEPTH} levels;
 * - a query that visits more than {@link MAX_VISITS} nodes throws.
 */

export type PathSegment =
  | { type: 'key'; key: string }
  | { type: 'index'; index: number }
  | { type: 'wildcard' }
  | { type: 'recursive'; key: string | null };

export const MAX_RESULTS = 10_000;
export const MAX_DEPTH = 1_000;
export const MAX_VISITS = 2_000_000;
const MAX_PATH_LENGTH = 4_096;

const NAME_STOP = new Set(['.', '[', ']', '(', ')', "'", '"', ',', '*', '?', ' ', '\t', '\n', '\r']);
const SIMPLE_ESCAPES: Record<string, string> = {
  "'": "'", '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
};

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isNameChar(ch: string | undefined): ch is string {
  return ch !== undefined && !NAME_STOP.has(ch);
}

/**
 * Parse a JSONPath into segments. Throws an Error whose message names the
 * 1-based position and what was expected there.
 */
export function parseJsonPath(path: string): PathSegment[] {
  if (typeof path !== 'string') throw new Error('JSONPath must be text');
  let end = path.length;
  while (end > 0 && isSpace(path[end - 1])) end--;
  let pos = 0;
  while (pos < end && isSpace(path[pos])) pos++;
  if (pos >= end) throw new Error('JSONPath is empty (use $ for the whole response)');
  if (end - pos > MAX_PATH_LENGTH) throw new Error(`JSONPath is too long (over ${MAX_PATH_LENGTH} characters)`);

  const segments: PathSegment[] = [];
  const at = (i: number): string | undefined => (i < end ? path[i] : undefined);

  const fail = (i: number, expected: string): never => {
    const ch = at(i);
    const found = ch === undefined ? 'the end of the path' : `'${ch}'`;
    throw new Error(`Invalid JSONPath at position ${i + 1}: expected ${expected} but found ${found}`);
  };

  const readName = (): string => {
    const start = pos;
    while (isNameChar(at(pos))) pos++;
    return path.slice(start, pos);
  };

  const skipSpaces = () => {
    while (isSpace(at(pos))) pos++;
  };

  const readQuoted = (quote: string): string => {
    const start = pos;
    pos++;
    let out = '';
    for (;;) {
      const ch = at(pos);
      if (ch === undefined) {
        throw new Error(`Invalid JSONPath: the string starting at position ${start + 1} is missing its closing ${quote}`);
      }
      if (ch === quote) {
        pos++;
        return out;
      }
      if (ch === '\\') {
        const esc = at(pos + 1);
        if (esc !== undefined && Object.prototype.hasOwnProperty.call(SIMPLE_ESCAPES, esc)) {
          out += SIMPLE_ESCAPES[esc];
          pos += 2;
          continue;
        }
        if (esc === 'u') {
          const hex = path.slice(pos + 2, pos + 6);
          if (pos + 6 <= end && /^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            pos += 6;
            continue;
          }
          fail(pos + 2, 'four hex digits after \\u');
        }
        fail(pos + 1, 'an escape such as \\\\, \\\', \\", \\n, \\t or \\uXXXX');
      }
      out += ch;
      pos++;
    }
  };

  const readIndex = (): number => {
    const start = pos;
    if (at(pos) === '-') pos++;
    const digitsStart = pos;
    while (isDigit(at(pos))) pos++;
    if (pos === digitsStart) fail(pos, 'a digit');
    const text = path.slice(start, pos);
    const n = Number(text);
    if (!Number.isSafeInteger(n)) throw new Error(`Invalid JSONPath at position ${start + 1}: index ${text} is too large`);
    return n === 0 ? 0 : n; // normalise -0
  };

  /** Parse `[...]` with `pos` on the `[`. */
  const readBracket = (): PathSegment => {
    pos++;
    skipSpaces();
    const ch = at(pos);
    let seg: PathSegment;
    if (ch === '?') {
      throw new Error(`Filter expressions like [?(...)] are not supported (position ${pos + 1})`);
    } else if (ch === '(') {
      throw new Error(`Script expressions like [(...)] are not supported (position ${pos + 1})`);
    } else if (ch === "'" || ch === '"') {
      seg = { type: 'key', key: readQuoted(ch) };
    } else if (ch === '*') {
      pos++;
      seg = { type: 'wildcard' };
    } else if (ch === '-' || isDigit(ch)) {
      seg = { type: 'index', index: readIndex() };
    } else {
      return fail(pos, "a quoted key, an index or * after '['");
    }
    skipSpaces();
    const close = at(pos);
    if (close === ']') {
      pos++;
      return seg;
    }
    if (close === ',') throw new Error(`Unions like [a,b] are not supported (position ${pos + 1})`);
    if (close === ':') throw new Error(`Slices like [0:2] are not supported (position ${pos + 1})`);
    return fail(pos, "']'");
  };

  // Root: `$` followed by the end, `.` or `[`. Otherwise a bare path (`data.items`,
  // `$ref.x`) whose first name is a key of the root.
  const next = at(pos + 1);
  if (path[pos] === '$' && (next === undefined || next === '.' || next === '[')) {
    pos++;
  } else if (isNameChar(path[pos])) {
    segments.push({ type: 'key', key: readName() });
  }

  while (pos < end) {
    const ch = at(pos);
    if (ch === '.') {
      if (at(pos + 1) === '.') {
        pos += 2;
        const n = at(pos);
        if (n === '*') {
          pos++;
          segments.push({ type: 'recursive', key: null });
        } else if (n === '[') {
          const bracketPos = pos;
          const seg = readBracket();
          if (seg.type === 'key') segments.push({ type: 'recursive', key: seg.key });
          else if (seg.type === 'wildcard') segments.push({ type: 'recursive', key: null });
          else throw new Error(`Index selectors after '..' are not supported (position ${bracketPos + 1})`);
        } else if (isNameChar(n)) {
          segments.push({ type: 'recursive', key: readName() });
        } else {
          fail(pos, "a property name, * or [ after '..'");
        }
      } else {
        pos++;
        const n = at(pos);
        if (n === '*') {
          pos++;
          segments.push({ type: 'wildcard' });
        } else if (isNameChar(n)) {
          segments.push({ type: 'key', key: readName() });
        } else {
          fail(pos, "a property name or * after '.'");
        }
      }
    } else if (ch === '[') {
      segments.push(readBracket());
    } else {
      fail(pos, "'.', '..' or '['");
    }
  }
  return segments;
}

/** True when the path can match at most one node (no wildcard or recursive descent). */
export function isDefinitePath(segments: PathSegment[]): boolean {
  return segments.every(s => s.type === 'key' || s.type === 'index');
}

type Member = { found: true; value: unknown } | { found: false };
const NOT_FOUND: Member = { found: false };
const CANONICAL_INDEX = /^(0|[1-9]\d*)$/;

function getMember(node: unknown, key: string): Member {
  if (Array.isArray(node)) {
    if (key === 'length') return { found: true, value: node.length };
    if (CANONICAL_INDEX.test(key)) {
      const i = Number(key);
      if (i < node.length) return { found: true, value: node[i] };
    }
    return NOT_FOUND;
  }
  if (typeof node === 'string') {
    return key === 'length' ? { found: true, value: node.length } : NOT_FOUND;
  }
  if (node !== null && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, key)) {
    return { found: true, value: (node as Record<string, unknown>)[key] };
  }
  return NOT_FOUND;
}

function isContainer(v: unknown): v is object {
  return v !== null && typeof v === 'object';
}

interface Budget { visits: number }

function descend(node: unknown, key: string | null, out: unknown[], budget: Budget): void {
  // Iterative pre-order walk. Stack entries: [value, member name (null for array elements), depth].
  const stack: Array<[unknown, string | null, number]> = [];
  const pushChildren = (parent: unknown, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(parent)) {
      for (let i = parent.length - 1; i >= 0; i--) stack.push([parent[i], null, depth]);
    } else if (isContainer(parent)) {
      const keys = Object.keys(parent);
      const rec = parent as Record<string, unknown>;
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i]!;
        stack.push([rec[k], k, depth]);
      }
    }
  };
  pushChildren(node, 1);
  while (stack.length > 0) {
    const [value, name, depth] = stack.pop()!;
    if (++budget.visits > MAX_VISITS) {
      throw new Error(`JSONPath query is too expensive: it visited more than ${MAX_VISITS.toLocaleString('en-US')} values`);
    }
    if (key === null || name === key) {
      out.push(value);
      if (out.length >= MAX_RESULTS) return;
    }
    if (isContainer(value)) pushChildren(value, depth + 1);
  }
}

function applySegment(node: unknown, seg: PathSegment, out: unknown[], budget: Budget): void {
  switch (seg.type) {
    case 'key': {
      const m = getMember(node, seg.key);
      if (m.found) out.push(m.value);
      return;
    }
    case 'index': {
      if (!Array.isArray(node)) return;
      const i = seg.index < 0 ? node.length + seg.index : seg.index;
      if (i >= 0 && i < node.length) out.push(node[i]);
      return;
    }
    case 'wildcard': {
      if (Array.isArray(node)) {
        for (const v of node) {
          if (out.length >= MAX_RESULTS) return;
          out.push(v);
        }
      } else if (isContainer(node)) {
        const rec = node as Record<string, unknown>;
        for (const k of Object.keys(rec)) {
          if (out.length >= MAX_RESULTS) return;
          out.push(rec[k]);
        }
      }
      return;
    }
    case 'recursive':
      descend(node, seg.key, out, budget);
      return;
  }
}

/** Evaluate already-parsed segments. Throws only when the visit budget is exceeded. */
export function evaluateJsonPath(value: unknown, segments: PathSegment[]): unknown[] {
  let nodes: unknown[] = [value];
  const budget: Budget = { visits: 0 };
  for (const seg of segments) {
    const next: unknown[] = [];
    for (const node of nodes) {
      if (next.length >= MAX_RESULTS) break;
      applySegment(node, seg, next, budget);
    }
    if (next.length > MAX_RESULTS) next.length = MAX_RESULTS;
    nodes = next;
    if (nodes.length === 0) break;
  }
  return nodes;
}

/** All matches in document order. Throws on an invalid path or an over-budget query. */
export function queryJsonPath(value: unknown, path: string): unknown[] {
  return evaluateJsonPath(value, parseJsonPath(path));
}

/**
 * The first match. `found` tells a matched `null` apart from no match.
 * Throws on an invalid path.
 */
export function firstMatch(value: unknown, path: string): { found: boolean; value: unknown } {
  const matches = queryJsonPath(value, path);
  return matches.length > 0 ? { found: true, value: matches[0] } : { found: false, value: undefined };
}
