import { describe, it, expect } from 'vitest';
import {
  newAssertion, evaluateAssertions, describeAssertion, opsForSource,
  newExtraction, runExtractions, applyExtractions,
  type Assertion, type Extraction, type ExtractionResult, type ResponseSnapshot,
} from '../utils/assertions';
import type { EnvVariable } from '../utils/environment';

const body = {
  data: [
    { id: 7, name: 'Ada', active: true, tags: ['x', 'y'], meta: null },
    { id: 8, name: 'Bob', active: false, tags: [] },
  ],
  total: '2',
  nested: { a: 1, b: [1, 2] },
};

const res: ResponseSnapshot = {
  status: 200,
  headers: [
    ['Content-Type', 'application/json; charset=utf-8'],
    ['X-Count', '42'],
    ['Set-Cookie', 'a=1'],
    ['set-cookie', 'b=2'],
  ],
  bodyText: JSON.stringify(body),
  time: 234.6,
};

let seq = 0;
function make(partial: Partial<Assertion>): Assertion {
  return { id: `a${++seq}`, enabled: true, source: 'jsonpath', path: '', op: 'equals', expected: '', ...partial };
}

function check(partial: Partial<Assertion>, response: ResponseSnapshot = res) {
  const results = evaluateAssertions([make(partial)], response);
  expect(results).toHaveLength(1);
  return results[0]!;
}

describe('newAssertion and opsForSource', () => {
  it('creates an enabled status assertion by default', () => {
    const a = newAssertion();
    expect(a).toMatchObject({ enabled: true, source: 'status', op: 'equals', expected: '200' });
    expect(a.id).toBeTruthy();
  });

  it('picks sensible defaults per source', () => {
    expect(newAssertion('time')).toMatchObject({ op: 'lt', expected: '1000' });
    expect(newAssertion('jsonpath')).toMatchObject({ op: 'exists' });
    expect(newAssertion('body')).toMatchObject({ op: 'contains' });
  });

  it('offers operators per source', () => {
    expect(opsForSource('time')).toEqual(['lt', 'lte', 'gt', 'gte']);
    expect(opsForSource('jsonpath')).toContain('type-is');
    expect(opsForSource('header')).toContain('exists');
    expect(opsForSource('status')).not.toContain('exists');
  });

  it('returns a copy', () => {
    opsForSource('time').push('equals');
    expect(opsForSource('time')).not.toContain('equals');
  });
});

describe('evaluateAssertions', () => {
  it('omits disabled assertions and keeps order and ids', () => {
    const list = [
      make({ id: 'one', source: 'status', expected: '200' }),
      make({ id: 'off', enabled: false, source: 'status', expected: '500' }),
      make({ id: 'two', source: 'status', op: 'lt', expected: '300' }),
    ];
    expect(evaluateAssertions(list, res).map(r => [r.id, r.pass])).toEqual([['one', true], ['two', true]]);
  });

  it('parses the body once per evaluation', () => {
    let reads = 0;
    const counted = { ...res, get bodyText() { reads++; return res.bodyText; } };
    evaluateAssertions([
      make({ path: '$.total', op: 'exists' }),
      make({ path: '$.data[0].id', expected: '7' }),
      make({ path: '$.nested', op: 'type-is', expected: 'object' }),
    ], counted);
    expect(reads).toBe(1);
  });

  describe('status', () => {
    it('passes with a readable message', () => {
      expect(check({ source: 'status', expected: '200' })).toEqual({
        id: expect.any(String), pass: true, actual: '200', message: 'status equals 200',
      });
    });

    it('fails with expected and actual', () => {
      const r = check({ source: 'status', expected: '200' }, { ...res, status: 404 });
      expect(r).toMatchObject({ pass: false, actual: '404', message: 'Expected status 200 but got 404' });
    });

    it('compares numerically and by pattern', () => {
      expect(check({ source: 'status', op: 'gte', expected: '200' }).pass).toBe(true);
      expect(check({ source: 'status', op: 'lt', expected: '200' }).pass).toBe(false);
      expect(check({ source: 'status', op: 'not-equals', expected: '500' }).pass).toBe(true);
      expect(check({ source: 'status', op: 'matches', expected: '^2\\d\\d$' }).pass).toBe(true);
    });
  });

  describe('header', () => {
    it('matches names case-insensitively', () => {
      expect(check({ source: 'header', path: 'content-type', op: 'exists' }).pass).toBe(true);
      expect(check({ source: 'header', path: 'CONTENT-TYPE', op: 'contains', expected: 'json' }).pass).toBe(true);
    });

    it('checks absence', () => {
      expect(check({ source: 'header', path: 'X-Missing', op: 'not-exists' }).pass).toBe(true);
      expect(check({ source: 'header', path: 'X-Missing', op: 'exists' })).toMatchObject({
        pass: false, message: 'Expected header X-Missing to exist',
      });
      expect(check({ source: 'header', path: 'X-Count', op: 'not-exists' })).toMatchObject({
        pass: false, message: 'Expected header X-Count not to exist but got 42',
      });
    });

    it('reports a missing header for value checks', () => {
      expect(check({ source: 'header', path: 'X-Missing', expected: 'a' })).toMatchObject({
        pass: false, message: 'Header X-Missing is not present',
      });
    });

    it('compares values as text and numbers', () => {
      expect(check({ source: 'header', path: 'x-count', expected: '42' }).pass).toBe(true);
      expect(check({ source: 'header', path: 'x-count', op: 'gt', expected: '40' }).pass).toBe(true);
    });

    it('joins repeated headers', () => {
      expect(check({ source: 'header', path: 'set-cookie', expected: 'a=1, b=2' }).pass).toBe(true);
    });

    it('requires a header name', () => {
      expect(check({ source: 'header', path: ' ', op: 'exists' })).toMatchObject({ pass: false, message: 'Enter a header name' });
    });
  });

  describe('jsonpath', () => {
    it('checks existence, including null values', () => {
      expect(check({ path: '$.data[0].meta', op: 'exists' }).pass).toBe(true);
      expect(check({ path: '$.data[0].nope', op: 'not-exists' }).pass).toBe(true);
      expect(check({ path: '$.data[0].nope', op: 'exists' })).toMatchObject({
        pass: false, message: 'Expected $.data[0].nope to exist',
      });
    });

    it('reports no match for value checks', () => {
      expect(check({ path: '$.nope', expected: '1' })).toMatchObject({ pass: false, actual: '', message: 'No match for $.nope' });
    });

    it('compares JSON-aware', () => {
      expect(check({ path: '$.data[0].id', expected: '7' }).pass).toBe(true);
      expect(check({ path: '$.data[0].name', expected: '"Ada"' }).pass).toBe(true);
      expect(check({ path: '$.data[0].name', expected: 'Ada' }).pass).toBe(true);
      expect(check({ path: '$.data[0].active', expected: 'true' }).pass).toBe(true);
      expect(check({ path: '$.data[0].meta', expected: 'null' }).pass).toBe(true);
    });

    it('does not equate a numeric string with a number', () => {
      expect(check({ path: '$.total', expected: '2' })).toMatchObject({
        pass: false, actual: '"2"', message: 'Expected $.total to equal 2 but got "2"',
      });
      expect(check({ path: '$.total', expected: '"2"' }).pass).toBe(true);
    });

    it('compares objects and arrays deeply, ignoring key order', () => {
      expect(check({ path: '$.nested', expected: '{"b":[1,2],"a":1}' }).pass).toBe(true);
      expect(check({ path: '$.nested', expected: '{"a":1,"b":[2,1]}' }).pass).toBe(false);
      expect(check({ path: '$.nested', op: 'not-equals', expected: '{"a":1}' }).pass).toBe(true);
    });

    it('contains: substring, array membership and object key', () => {
      expect(check({ path: '$.data[0].name', op: 'contains', expected: 'd' }).pass).toBe(true);
      expect(check({ path: '$.data[0].tags', op: 'contains', expected: 'x' }).pass).toBe(true);
      expect(check({ path: '$.data[0].tags', op: 'contains', expected: '"y"' }).pass).toBe(true);
      expect(check({ path: '$.nested.b', op: 'contains', expected: '2' }).pass).toBe(true);
      expect(check({ path: '$.nested', op: 'contains', expected: 'a' }).pass).toBe(true);
      expect(check({ path: '$.data[1].tags', op: 'not-contains', expected: 'x' }).pass).toBe(true);
    });

    it('fails contains on a value that cannot contain anything', () => {
      expect(check({ path: '$.data[0].id', op: 'contains', expected: '7' })).toMatchObject({
        pass: false, message: expect.stringMatching(/Cannot check whether \$\.data\[0\]\.id contains a value: it is number/),
      });
    });

    it('collects all matches for wildcard and recursive paths', () => {
      expect(check({ path: '$.data[*].id', op: 'contains', expected: '8' }).pass).toBe(true);
      expect(check({ path: '$..id', expected: '[7,8]' }).pass).toBe(true);
      expect(check({ path: '$..name', op: 'type-is', expected: 'array' }).pass).toBe(true);
    });

    it('compares numbers, accepting numeric strings', () => {
      expect(check({ path: '$.total', op: 'lt', expected: '3' }).pass).toBe(true);
      expect(check({ path: '$.data.length', op: 'gte', expected: '2' }).pass).toBe(true);
      expect(check({ path: '$.data[0].id', op: 'lte', expected: '6.5' }).pass).toBe(false);
    });

    it('explains non-numeric comparisons', () => {
      expect(check({ path: '$.data[0].name', op: 'gt', expected: '1' })).toMatchObject({
        pass: false, message: 'Expected $.data[0].name to be a number but got "Ada"',
      });
      expect(check({ path: '$.data[0].id', op: 'gt', expected: 'abc' })).toMatchObject({
        pass: false, message: 'Expected value abc is not a number',
      });
    });

    it('matches regular expressions, with optional /flags/', () => {
      expect(check({ path: '$.data[0].name', op: 'matches', expected: '^A' }).pass).toBe(true);
      expect(check({ path: '$.data[0].name', op: 'matches', expected: '/^ada$/i' }).pass).toBe(true);
      expect(check({ path: '$.data[0].name', op: 'matches', expected: '^ada$' }).pass).toBe(false);
      expect(check({ path: '$.data[0].id', op: 'matches', expected: '^\\d+$' }).pass).toBe(true);
    });

    it('fails an invalid regular expression without throwing', () => {
      expect(check({ path: '$.data[0].name', op: 'matches', expected: '(' })).toMatchObject({
        pass: false, message: expect.stringMatching(/^Invalid regular expression/),
      });
    });

    it('checks JSON types', () => {
      expect(check({ path: '$.data[0].name', op: 'type-is', expected: 'string' }).pass).toBe(true);
      expect(check({ path: '$.data[0].id', op: 'type-is', expected: 'number' }).pass).toBe(true);
      expect(check({ path: '$.data[0].active', op: 'type-is', expected: 'Boolean' }).pass).toBe(true);
      expect(check({ path: '$.data[0].meta', op: 'type-is', expected: 'null' }).pass).toBe(true);
      expect(check({ path: '$.data', op: 'type-is', expected: 'array' }).pass).toBe(true);
      expect(check({ path: '$.nested', op: 'type-is', expected: 'object' }).pass).toBe(true);
      expect(check({ path: '$.total', op: 'type-is', expected: 'number' })).toMatchObject({
        pass: false, message: 'Expected $.total to be of type number but got string',
      });
      expect(check({ path: '$.total', op: 'type-is', expected: 'int' }).message).toMatch(/Unknown type int/);
    });

    it('fails every JSONPath assertion when the body is not JSON', () => {
      const html = { ...res, bodyText: '<html></html>' };
      const results = evaluateAssertions([
        make({ path: '$.a', op: 'exists' }),
        make({ path: '$.a', op: 'not-exists' }),
      ], html);
      expect(results.map(r => [r.pass, r.message])).toEqual([
        [false, 'Response body is not JSON'],
        [false, 'Response body is not JSON'],
      ]);
    });

    it('reports invalid and empty paths', () => {
      expect(check({ path: '$.data[?(@.id)]', op: 'exists' }).message).toMatch(/Filter expressions .* not supported/);
      expect(check({ path: '', op: 'exists' }).message).toBe('Enter a JSONPath');
    });
  });

  describe('body', () => {
    it('checks text', () => {
      expect(check({ source: 'body', op: 'contains', expected: '"name":"Ada"' }).pass).toBe(true);
      expect(check({ source: 'body', op: 'not-contains', expected: 'Carol' }).pass).toBe(true);
      expect(check({ source: 'body', op: 'matches', expected: '"id":\\s*8' }).pass).toBe(true);
    });

    it('equals exactly or as equal JSON', () => {
      const small = { ...res, bodyText: '{"a": 1, "b": [true]}' };
      expect(check({ source: 'body', expected: '{"a": 1, "b": [true]}' }, small).pass).toBe(true);
      expect(check({ source: 'body', expected: '{"b":[true],"a":1}' }, small).pass).toBe(true);
      expect(check({ source: 'body', expected: '{"a":2}' }, small).pass).toBe(false);
      expect(check({ source: 'body', expected: 'OK' }, { ...res, bodyText: 'OK' }).pass).toBe(true);
    });

    it('truncates long actual values', () => {
      const long = { ...res, bodyText: 'a'.repeat(5000) };
      const r = check({ source: 'body', op: 'contains', expected: 'zzz' }, long);
      expect(r.pass).toBe(false);
      expect(r.actual.length).toBeLessThanOrEqual(200);
      expect(r.actual.endsWith('…')).toBe(true);
    });

    it('caps regular expression input', () => {
      const huge = { ...res, bodyText: `${'a'.repeat(150_000)}b` };
      expect(check({ source: 'body', op: 'matches', expected: 'b' }, huge).pass).toBe(false);
      expect(check({ source: 'body', op: 'matches', expected: '^a+' }, huge).pass).toBe(true);
    });
  });

  describe('time', () => {
    it('uses milliseconds', () => {
      expect(check({ source: 'time', op: 'lt', expected: '500' })).toMatchObject({
        pass: true, actual: '235 ms', message: 'response time < 500 ms',
      });
      expect(check({ source: 'time', op: 'lt', expected: '100' })).toMatchObject({
        pass: false, message: 'Expected response time to be < 100 ms but got 235 ms',
      });
    });
  });
});

describe('describeAssertion', () => {
  it('describes each shape', () => {
    expect(describeAssertion(make({ source: 'status', op: 'equals', expected: '200' }))).toBe('status equals 200');
    expect(describeAssertion(make({ path: '$.data[0].id', op: 'exists' }))).toBe('$.data[0].id exists');
    expect(describeAssertion(make({ source: 'time', op: 'lt', expected: '500' }))).toBe('response time < 500 ms');
    expect(describeAssertion(make({ source: 'header', path: 'Content-Type', op: 'contains', expected: 'json' })))
      .toBe('header Content-Type contains json');
    expect(describeAssertion(make({ source: 'body', op: 'not-contains', expected: '' }))).toBe('body does not contain ""');
    expect(describeAssertion(make({ path: '$.n', op: 'type-is', expected: 'number' }))).toBe('$.n is of type number');
  });
});

describe('runExtractions', () => {
  function x(partial: Partial<Extraction>): Extraction {
    return { id: `x${++seq}`, enabled: true, source: 'jsonpath', path: '', variable: 'v', ...partial };
  }

  it('creates an enabled JSONPath extraction', () => {
    expect(newExtraction()).toMatchObject({ enabled: true, source: 'jsonpath', path: '', variable: '' });
  });

  it('extracts strings as-is and other values as JSON', () => {
    const results = runExtractions([
      x({ path: '$.data[0].name', variable: 'name' }),
      x({ path: '$.data[0].id', variable: 'id' }),
      x({ path: '$.nested', variable: 'obj' }),
      x({ path: '$.data[0].meta', variable: 'meta' }),
    ], res);
    expect(results.map(r => [r.variable, r.ok, r.value])).toEqual([
      ['name', true, 'Ada'],
      ['id', true, '7'],
      ['obj', true, '{"a":1,"b":[1,2]}'],
      ['meta', true, 'null'],
    ]);
  });

  it('takes the first match of a wildcard path', () => {
    expect(runExtractions([x({ path: '$.data[*].name' })], res)[0]).toMatchObject({ ok: true, value: 'Ada' });
  });

  it('extracts headers, status and body', () => {
    const results = runExtractions([
      x({ source: 'header', path: 'x-count', variable: 'count' }),
      x({ source: 'status', variable: 'code' }),
      x({ source: 'body', variable: 'raw' }),
    ], { ...res, bodyText: 'plain' });
    expect(results.map(r => r.value)).toEqual(['42', '200', 'plain']);
  });

  it('validates variable names', () => {
    const results = runExtractions([
      x({ variable: '' }),
      x({ variable: '1abc', path: '$.total' }),
      x({ variable: 'has space', path: '$.total' }),
      x({ variable: 'auth.token-2', path: '$.total' }),
      x({ variable: '_ok', path: '$.total' }),
    ], res);
    expect(results.map(r => r.ok)).toEqual([false, false, false, true, true]);
    expect(results[0]!.message).toBe('Enter a variable name');
    expect(results[1]!.message).toMatch(/Invalid variable name "1abc"/);
  });

  it('reports failures', () => {
    const results = runExtractions([
      x({ path: '$.nope' }),
      x({ source: 'header', path: 'X-None' }),
      x({ path: '$[' }),
    ], res);
    expect(results.map(r => [r.ok, r.message])).toEqual([
      [false, 'No match for $.nope'],
      [false, 'Header X-None is not present'],
      [false, expect.stringMatching(/^Invalid JSONPath at position 3/)],
    ]);
    expect(runExtractions([x({ path: '$.a' })], { ...res, bodyText: 'nope' })[0]!.message).toBe('Response body is not JSON');
  });

  it('omits disabled extractions', () => {
    expect(runExtractions([x({ enabled: false, path: '$.total' })], res)).toEqual([]);
  });
});

describe('applyExtractions', () => {
  const ok = (variable: string, value: string): ExtractionResult => ({ id: variable, variable, ok: true, value, message: '' });

  it('updates an existing variable, keeping its other fields', () => {
    const vars: EnvVariable[] = [{ key: 'token', value: 'old', enabled: false }, { key: 'base', value: 'b', enabled: true }];
    expect(applyExtractions(vars, [ok('token', 'new')])).toEqual([
      { key: 'token', value: 'new', enabled: false },
      { key: 'base', value: 'b', enabled: true },
    ]);
  });

  it('appends a new enabled variable', () => {
    expect(applyExtractions([], [ok('id', '7')])).toEqual([{ key: 'id', value: '7', enabled: true }]);
  });

  it('ignores failed results', () => {
    const vars: EnvVariable[] = [{ key: 'id', value: '1', enabled: true }];
    const failed: ExtractionResult = { id: 'f', variable: 'id', ok: false, value: '', message: 'No match' };
    expect(applyExtractions(vars, [failed])).toEqual(vars);
  });

  it('does not mutate the input and lets later results win', () => {
    const vars: EnvVariable[] = [{ key: 'id', value: '1', enabled: true }];
    const next = applyExtractions(vars, [ok('id', '2'), ok('id', '3'), ok('new', 'n')]);
    expect(vars).toEqual([{ key: 'id', value: '1', enabled: true }]);
    expect(next).toEqual([{ key: 'id', value: '3', enabled: true }, { key: 'new', value: 'n', enabled: true }]);
  });
});
