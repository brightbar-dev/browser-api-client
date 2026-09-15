/**
 * Response tests ("assertions") and setting variables from a response, both
 * declarative so that no user script is ever evaluated.
 *
 * Value semantics:
 * - `status` and `time` are numbers; `header` and `body` are strings. Header names
 *   are case-insensitive, and repeated headers are joined with ", ".
 * - `jsonpath` parses the body once per evaluation. A path with no wildcard or
 *   recursive descent yields its single match; one with `*` or `..` yields the
 *   array of all matches (so `$..id contains 5` works). Extraction always takes
 *   the first match.
 * - `equals` is JSON-aware: when `expected` parses as JSON (`200`, `true`, `null`,
 *   `"x"`, `{"a":1}`) it is compared by deep equality; otherwise it is compared as
 *   text with a primitive's string form. Headers and bodies also pass on an exact
 *   text match, and a JSON body equals a JSON `expected` that is deeply equal.
 * - `contains`: substring for strings, JSON-aware membership for arrays, own key
 *   for objects.
 * - `lt`/`lte`/`gt`/`gte` need numbers; numeric strings count.
 * - `matches` takes a regular expression, optionally written `/pattern/flags`. The
 *   input is capped at {@link REGEX_INPUT_MAX} characters.
 * - `type-is` takes string, number, boolean, null, array or object.
 */

import type { EnvVariable } from './environment';
import { generateId } from './request';
import { evaluateJsonPath, isDefinitePath, parseJsonPath } from './jsonpath';

export interface ResponseSnapshot {
  status: number;
  headers: Array<[string, string]>;
  bodyText: string;
  /** Milliseconds. */
  time: number;
}

export type AssertionSource = 'status' | 'header' | 'jsonpath' | 'body' | 'time';

export type AssertionOp =
  | 'equals' | 'not-equals' | 'exists' | 'not-exists' | 'contains' | 'not-contains'
  | 'lt' | 'lte' | 'gt' | 'gte' | 'matches' | 'type-is';

export interface Assertion {
  id: string;
  enabled: boolean;
  source: AssertionSource;
  /** Header name for `header`, JSONPath for `jsonpath`, unused otherwise. */
  path: string;
  op: AssertionOp;
  expected: string;
}

export interface AssertionResult {
  id: string;
  pass: boolean;
  /** Short display form of the actual value (truncated). */
  actual: string;
  message: string;
}

export interface Extraction {
  id: string;
  enabled: boolean;
  source: 'jsonpath' | 'header' | 'status' | 'body';
  path: string;
  variable: string;
}

export interface ExtractionResult {
  id: string;
  variable: string;
  ok: boolean;
  value: string;
  message: string;
}

export const REGEX_INPUT_MAX = 100_000;
export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export const JSON_TYPES = ['string', 'number', 'boolean', 'null', 'array', 'object'] as const;

const ACTUAL_MAX = 200;
const EXPECTED_SHOWN_MAX = 100;
const MAX_EQUAL_DEPTH = 1_000;

const OPS: Record<AssertionSource, AssertionOp[]> = {
  status: ['equals', 'not-equals', 'lt', 'lte', 'gt', 'gte', 'matches'],
  header: ['exists', 'not-exists', 'equals', 'not-equals', 'contains', 'not-contains', 'matches', 'lt', 'lte', 'gt', 'gte'],
  jsonpath: ['exists', 'not-exists', 'equals', 'not-equals', 'contains', 'not-contains', 'lt', 'lte', 'gt', 'gte', 'matches', 'type-is'],
  body: ['contains', 'not-contains', 'equals', 'not-equals', 'matches'],
  time: ['lt', 'lte', 'gt', 'gte'],
};

const OP_WORDS: Record<AssertionOp, string> = {
  equals: 'equals',
  'not-equals': 'does not equal',
  exists: 'exists',
  'not-exists': 'does not exist',
  contains: 'contains',
  'not-contains': 'does not contain',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  matches: 'matches',
  'type-is': 'is of type',
};

const DEFAULTS: Record<AssertionSource, Pick<Assertion, 'path' | 'op' | 'expected'>> = {
  status: { path: '', op: 'equals', expected: '200' },
  header: { path: '', op: 'exists', expected: '' },
  jsonpath: { path: '', op: 'exists', expected: '' },
  body: { path: '', op: 'contains', expected: '' },
  time: { path: '', op: 'lt', expected: '1000' },
};

/** Operators that make sense for a source, in display order. */
export function opsForSource(source: AssertionSource): AssertionOp[] {
  return [...((OPS[source] as AssertionOp[] | undefined) ?? [])];
}

export function newAssertion(source: AssertionSource = 'status'): Assertion {
  const d = DEFAULTS[source] ?? DEFAULTS.status;
  return { id: generateId(), enabled: true, source, ...d };
}

export function newExtraction(): Extraction {
  return { id: generateId(), enabled: true, source: 'jsonpath', path: '', variable: '' };
}

export function isValidVariableName(name: string): boolean {
  return VARIABLE_NAME_PATTERN.test(name);
}

// ---------------------------------------------------------------------------
// Helpers

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

type Parsed = { ok: true; value: unknown } | { ok: false };

function parseJsonText(text: string): Parsed {
  if (text.trim() === '') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function typeOfJson(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function deepEqual(a: unknown, b: unknown, depth: number): boolean {
  if (a === b) return true;
  if (depth > MAX_EQUAL_DEPTH) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object' && !Array.isArray(b)) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra);
    if (ka.length !== Object.keys(rb).length) return false;
    for (const k of ka) {
      if (!hasOwn(rb, k) || !deepEqual(ra[k], rb[k], depth + 1)) return false;
    }
    return true;
  }
  return false;
}

/** JSON-aware comparison of a JSON value with user-typed text. */
function valueMatchesExpected(actual: unknown, expected: string): boolean {
  const parsed = parseJsonText(expected);
  if (parsed.ok) return deepEqual(actual, parsed.value, 0);
  return isPrimitive(actual) && String(actual) === expected;
}

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function parseNumber(text: string): number | undefined {
  const t = text.trim();
  if (!NUMBER_RE.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return parseNumber(v);
  return undefined;
}

function compileUserRegex(source: string): RegExp {
  const literal = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(source);
  if (literal) {
    try {
      return new RegExp(literal[1] ?? '', literal[2]);
    } catch {
      // Not a valid /pattern/flags; fall back to the whole text as a pattern.
    }
  }
  try {
    return new RegExp(source);
  } catch (e) {
    const msg = errorMessage(e);
    throw new Error(msg.startsWith('Invalid regular expression') ? msg : `Invalid regular expression: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Resolving a source against a response

interface Context {
  res: ResponseSnapshot;
  /** The parsed body; throws "Response body is not JSON". */
  json(): unknown;
  tryJson(): Parsed;
}

function createContext(res: ResponseSnapshot): Context {
  const cache: { parsed: Parsed | null } = { parsed: null };
  const tryJson = (): Parsed => {
    if (cache.parsed === null) cache.parsed = parseJsonText(res.bodyText);
    return cache.parsed;
  };
  return {
    res,
    tryJson,
    json() {
      const p = tryJson();
      if (!p.ok) throw new Error('Response body is not JSON');
      return p.value;
    },
  };
}

type Resolved = { found: true; value: unknown } | { found: false; reason: string };

function resolveSource(source: AssertionSource, path: string, ctx: Context, allMatches: boolean): Resolved {
  const { res } = ctx;
  switch (source) {
    case 'status':
      return { found: true, value: res.status };
    case 'time':
      return { found: true, value: res.time };
    case 'body':
      return { found: true, value: res.bodyText };
    case 'header': {
      const name = path.trim();
      if (!name) throw new Error('Enter a header name');
      const lower = name.toLowerCase();
      const values = res.headers.filter(([k]) => k.toLowerCase() === lower).map(([, v]) => v);
      return values.length > 0
        ? { found: true, value: values.join(', ') }
        : { found: false, reason: `Header ${name} is not present` };
    }
    case 'jsonpath': {
      const p = path.trim();
      if (!p) throw new Error('Enter a JSONPath');
      const segments = parseJsonPath(p);
      const matches = evaluateJsonPath(ctx.json(), segments);
      if (matches.length === 0) return { found: false, reason: `No match for ${p}` };
      return { found: true, value: allMatches && !isDefinitePath(segments) ? matches : matches[0] };
    }
    default:
      throw new Error(`Unknown source "${String(source)}"`);
  }
}

function subjectOf(source: AssertionSource, path: string): string {
  switch (source) {
    case 'status': return 'status';
    case 'time': return 'response time';
    case 'body': return 'body';
    case 'header': return `header ${path.trim() || '(no name)'}`;
    case 'jsonpath': return path.trim() || '(no path)';
    default: return String(source);
  }
}

function displayActual(v: unknown, source: AssertionSource): string {
  let s: string;
  if (source === 'time' && typeof v === 'number') s = `${Math.round(v)} ms`;
  else if (typeof v === 'string') s = source === 'jsonpath' ? JSON.stringify(v) : v;
  else s = safeStringify(v);
  return truncate(s, ACTUAL_MAX);
}

function equalsFor(source: AssertionSource, actual: unknown, expected: string, ctx: Context): boolean {
  switch (source) {
    case 'status':
    case 'time': {
      const n = parseNumber(expected);
      return n !== undefined ? actual === n : String(actual) === expected.trim();
    }
    case 'header': {
      const e = expected.trim();
      if (actual === e) return true;
      const p = parseJsonText(e);
      return p.ok && typeof p.value === 'string' && p.value === actual;
    }
    case 'body': {
      if (actual === expected) return true;
      const p = parseJsonText(expected);
      if (!p.ok) return false;
      const body = ctx.tryJson();
      return body.ok && deepEqual(body.value, p.value, 0);
    }
    default:
      return valueMatchesExpected(actual, expected);
  }
}

function containsFor(source: AssertionSource, subject: string, actual: unknown, expected: string): boolean {
  if (typeof actual === 'string') {
    if (actual.includes(expected)) return true;
    if (source !== 'jsonpath') return false;
    const p = parseJsonText(expected);
    return p.ok && typeof p.value === 'string' && actual.includes(p.value);
  }
  if (Array.isArray(actual)) return actual.some(el => valueMatchesExpected(el, expected));
  if (actual !== null && typeof actual === 'object') {
    if (hasOwn(actual, expected)) return true;
    const p = parseJsonText(expected);
    return p.ok && typeof p.value === 'string' && hasOwn(actual, p.value);
  }
  throw new Error(`Cannot check whether ${subject} contains a value: it is ${typeOfJson(actual)}, not a string, array or object`);
}

function evaluateOne(a: Assertion, ctx: Context): AssertionResult {
  const subject = subjectOf(a.source, a.path);
  const pass = (actual: string): AssertionResult => ({ id: a.id, pass: true, actual, message: describeAssertion(a) });
  const fail = (actual: string, message: string): AssertionResult => ({ id: a.id, pass: false, actual, message });

  let resolved: Resolved;
  try {
    resolved = resolveSource(a.source, a.path, ctx, true);
  } catch (e) {
    return fail('', errorMessage(e));
  }

  if (a.op === 'exists') {
    return resolved.found ? pass(displayActual(resolved.value, a.source)) : fail('', `Expected ${subject} to exist`);
  }
  if (a.op === 'not-exists') {
    if (!resolved.found) return pass('');
    const shown = displayActual(resolved.value, a.source);
    return fail(shown, `Expected ${subject} not to exist but got ${shown}`);
  }
  if (!resolved.found) return fail('', resolved.reason);

  const value = resolved.value;
  const actual = displayActual(value, a.source);
  const unit = a.source === 'time' ? ' ms' : '';
  const expectedShown = a.expected === '' ? '""' : truncate(a.expected, EXPECTED_SHOWN_MAX);

  try {
    switch (a.op) {
      case 'equals':
        if (equalsFor(a.source, value, a.expected, ctx)) return pass(actual);
        return fail(actual, a.source === 'status'
          ? `Expected status ${expectedShown.trim()} but got ${actual}`
          : `Expected ${subject} to equal ${expectedShown}${unit} but got ${actual}`);
      case 'not-equals':
        if (!equalsFor(a.source, value, a.expected, ctx)) return pass(actual);
        return fail(actual, `Expected ${subject} not to equal ${expectedShown}${unit}`);
      case 'contains':
        if (containsFor(a.source, subject, value, a.expected)) return pass(actual);
        return fail(actual, `Expected ${subject} to contain ${expectedShown}`);
      case 'not-contains':
        if (!containsFor(a.source, subject, value, a.expected)) return pass(actual);
        return fail(actual, `Expected ${subject} not to contain ${expectedShown}`);
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte': {
        const limit = parseNumber(a.expected);
        if (limit === undefined) return fail(actual, `Expected value ${expectedShown} is not a number`);
        const n = toNumber(value);
        if (n === undefined) return fail(actual, `Expected ${subject} to be a number but got ${actual}`);
        const ok = a.op === 'lt' ? n < limit : a.op === 'lte' ? n <= limit : a.op === 'gt' ? n > limit : n >= limit;
        if (ok) return pass(actual);
        return fail(actual, `Expected ${subject} to be ${OP_WORDS[a.op]} ${limit}${unit} but got ${actual}`);
      }
      case 'matches': {
        const re = compileUserRegex(a.expected);
        const input = (typeof value === 'string' ? value : safeStringify(value)).slice(0, REGEX_INPUT_MAX);
        if (re.test(input)) return pass(actual);
        return fail(actual, `Expected ${subject} to match ${expectedShown}`);
      }
      case 'type-is': {
        const want = a.expected.trim().toLowerCase();
        if (!(JSON_TYPES as readonly string[]).includes(want)) {
          return fail(actual, `Unknown type ${expectedShown}: use string, number, boolean, null, array or object`);
        }
        const got = typeOfJson(value);
        if (got === want) return pass(actual);
        return fail(actual, `Expected ${subject} to be of type ${want} but got ${got}`);
      }
      default:
        return fail(actual, `Unknown operator "${String(a.op)}"`);
    }
  } catch (e) {
    return fail(actual, errorMessage(e));
  }
}

/** Evaluate enabled assertions in order; disabled ones are omitted from the results. */
export function evaluateAssertions(assertions: Assertion[], res: ResponseSnapshot): AssertionResult[] {
  const ctx = createContext(res);
  return assertions.filter(a => a.enabled).map(a => evaluateOne(a, ctx));
}

/** One-line description, e.g. "status equals 200", "$.data[0].id exists", "response time < 500 ms". */
export function describeAssertion(a: Assertion): string {
  const subject = subjectOf(a.source, a.path);
  const word = OP_WORDS[a.op] ?? String(a.op);
  if (a.op === 'exists' || a.op === 'not-exists') return `${subject} ${word}`;
  const expected = a.expected === '' ? '""' : truncate(a.expected, EXPECTED_SHOWN_MAX);
  const unit = a.source === 'time' && a.op !== 'matches' ? ' ms' : '';
  return `${subject} ${word} ${expected}${unit}`;
}

// ---------------------------------------------------------------------------
// Variable extraction

/** Run enabled extractions in order (disabled ones are omitted). JSONPath takes the first match. */
export function runExtractions(extractions: Extraction[], res: ResponseSnapshot): ExtractionResult[] {
  const ctx = createContext(res);
  const results: ExtractionResult[] = [];
  for (const x of extractions) {
    if (!x.enabled) continue;
    const variable = x.variable.trim();
    const failed = (message: string): ExtractionResult => ({ id: x.id, variable, ok: false, value: '', message });
    if (!variable) {
      results.push(failed('Enter a variable name'));
      continue;
    }
    if (!VARIABLE_NAME_PATTERN.test(variable)) {
      results.push(failed(`Invalid variable name "${truncate(variable, 50)}": start with a letter or _, then use letters, digits, _, . or -`));
      continue;
    }
    try {
      const r = resolveSource(x.source, x.path, ctx, false);
      if (!r.found) {
        results.push(failed(r.reason));
        continue;
      }
      const value = typeof r.value === 'string' ? r.value : safeStringify(r.value);
      results.push({ id: x.id, variable, ok: true, value, message: `Set ${variable} from ${subjectOf(x.source, x.path)}` });
    } catch (e) {
      results.push(failed(errorMessage(e)));
    }
  }
  return results;
}

/**
 * Apply successful extraction results to a variable list, returning a new list.
 * An existing key keeps its other fields (including `enabled`) and gets the new
 * value; a new key is appended as an enabled variable. Failed results change nothing.
 */
export function applyExtractions(variables: EnvVariable[], results: ExtractionResult[]): EnvVariable[] {
  const next = [...variables];
  for (const r of results) {
    if (!r.ok || !VARIABLE_NAME_PATTERN.test(r.variable)) continue;
    let updated = false;
    for (let i = 0; i < next.length; i++) {
      const v = next[i]!;
      if (v.key === r.variable) {
        next[i] = { ...v, value: r.value };
        updated = true;
      }
    }
    if (!updated) next.push({ key: r.variable, value: r.value, enabled: true });
  }
  return next;
}
