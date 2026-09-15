import { describe, it, expect } from 'vitest';
import {
  parseJsonPath, queryJsonPath, firstMatch, isDefinitePath,
  MAX_RESULTS, MAX_DEPTH,
} from '../utils/jsonpath';

describe('parseJsonPath', () => {
  it('parses the root alone', () => {
    expect(parseJsonPath('$')).toEqual([]);
  });

  it('parses dot and bracket keys', () => {
    expect(parseJsonPath(`$.data['a b']["c.d"]`)).toEqual([
      { type: 'key', key: 'data' },
      { type: 'key', key: 'a b' },
      { type: 'key', key: 'c.d' },
    ]);
  });

  it('parses indexes, including negative ones', () => {
    expect(parseJsonPath('$.items[0][-1]')).toEqual([
      { type: 'key', key: 'items' },
      { type: 'index', index: 0 },
      { type: 'index', index: -1 },
    ]);
  });

  it('parses both wildcard forms', () => {
    expect(parseJsonPath('$[*].*')).toEqual([{ type: 'wildcard' }, { type: 'wildcard' }]);
  });

  it('parses recursive descent forms', () => {
    expect(parseJsonPath(`$..id..*..['a.b']..[*]`)).toEqual([
      { type: 'recursive', key: 'id' },
      { type: 'recursive', key: null },
      { type: 'recursive', key: 'a.b' },
      { type: 'recursive', key: null },
    ]);
  });

  it('accepts a bare path without $', () => {
    expect(parseJsonPath('data.items[0].id')).toEqual([
      { type: 'key', key: 'data' },
      { type: 'key', key: 'items' },
      { type: 'index', index: 0 },
      { type: 'key', key: 'id' },
    ]);
    expect(parseJsonPath(`['a']`)).toEqual([{ type: 'key', key: 'a' }]);
    expect(parseJsonPath('.a')).toEqual([{ type: 'key', key: 'a' }]);
    expect(parseJsonPath('..a')).toEqual([{ type: 'recursive', key: 'a' }]);
  });

  it('treats $ followed by a name as part of a key', () => {
    expect(parseJsonPath('$ref')).toEqual([{ type: 'key', key: '$ref' }]);
    expect(parseJsonPath('$.$ref')).toEqual([{ type: 'key', key: '$ref' }]);
  });

  it('allows unusual characters in unquoted keys', () => {
    expect(parseJsonPath('$.@type.content-type')).toEqual([
      { type: 'key', key: '@type' },
      { type: 'key', key: 'content-type' },
    ]);
  });

  it('ignores whitespace around the path and inside brackets', () => {
    expect(parseJsonPath(`  $[ 0 ][ "a" ]  `)).toEqual([
      { type: 'index', index: 0 },
      { type: 'key', key: 'a' },
    ]);
  });

  it('decodes escapes in quoted keys', () => {
    expect(parseJsonPath(`$['it\\'s']`)).toEqual([{ type: 'key', key: "it's" }]);
    expect(parseJsonPath(`$["\\u00e9\\n\\"\\\\"]`)).toEqual([{ type: 'key', key: 'é\n"\\' }]);
  });

  it('rejects filter expressions', () => {
    expect(() => parseJsonPath('$.items[?(@.id==1)]'))
      .toThrow('Filter expressions like [?(...)] are not supported (position 9)');
  });

  it('rejects script expressions', () => {
    expect(() => parseJsonPath('$[(@.length-1)]'))
      .toThrow('Script expressions like [(...)] are not supported (position 3)');
  });

  it('rejects unions and slices', () => {
    expect(() => parseJsonPath('$[0,1]')).toThrow(/Unions .* not supported \(position 4\)/);
    expect(() => parseJsonPath('$[0:2]')).toThrow(/Slices .* not supported \(position 4\)/);
  });

  it('rejects index selectors after ..', () => {
    expect(() => parseJsonPath('$..[0]')).toThrow(/Index selectors after '\.\.' are not supported/);
  });

  it('rejects an empty path', () => {
    expect(() => parseJsonPath('')).toThrow(/empty/);
    expect(() => parseJsonPath('   ')).toThrow(/empty/);
  });

  it('reports the position and what was expected', () => {
    expect(() => parseJsonPath('$.'))
      .toThrow("Invalid JSONPath at position 3: expected a property name or * after '.' but found the end of the path");
    expect(() => parseJsonPath('$.a b'))
      .toThrow("Invalid JSONPath at position 4: expected '.', '..' or '[' but found ' '");
    expect(() => parseJsonPath('$[abc]'))
      .toThrow("Invalid JSONPath at position 3: expected a quoted key, an index or * after '[' but found 'a'");
    expect(() => parseJsonPath('$[1')).toThrow("position 4: expected ']' but found the end of the path");
    expect(() => parseJsonPath('$..')).toThrow(/position 4: expected a property name, \* or \[ after '\.\.'/);
  });

  it('reports unterminated strings and bad escapes', () => {
    expect(() => parseJsonPath(`$['abc`)).toThrow(/position 3 is missing its closing '/);
    expect(() => parseJsonPath(`$['\\q']`)).toThrow(/expected an escape/);
    expect(() => parseJsonPath(`$['\\u12']`)).toThrow(/four hex digits/);
  });

  it('rejects indexes that are not safe integers', () => {
    expect(() => parseJsonPath('$[99999999999999999999]')).toThrow(/too large/);
  });
});

describe('queryJsonPath', () => {
  const doc = {
    store: {
      book: [
        { title: 'A', price: 8, tags: ['x', 'y'] },
        { title: 'B', price: 12 },
      ],
      bicycle: { color: 'red', price: 20 },
    },
    count: 2,
    nothing: null,
  };

  it('returns the root for $', () => {
    expect(queryJsonPath(doc, '$')).toEqual([doc]);
  });

  it('follows keys and indexes', () => {
    expect(queryJsonPath(doc, '$.store.book[1].title')).toEqual(['B']);
    expect(queryJsonPath(doc, `store['bicycle']["color"]`)).toEqual(['red']);
  });

  it('counts negative indexes from the end', () => {
    expect(queryJsonPath(doc, '$.store.book[-1].title')).toEqual(['B']);
    expect(queryJsonPath(doc, '$.store.book[-3]')).toEqual([]);
    expect(queryJsonPath(doc, '$.store.book[2]')).toEqual([]);
  });

  it('matches null values', () => {
    expect(queryJsonPath(doc, '$.nothing')).toEqual([null]);
  });

  it('expands wildcards over arrays and objects', () => {
    expect(queryJsonPath(doc, '$.store.book[*].title')).toEqual(['A', 'B']);
    expect(queryJsonPath(doc, '$.store.bicycle.*')).toEqual(['red', 20]);
  });

  it('finds keys recursively in document order', () => {
    expect(queryJsonPath(doc, '$..price')).toEqual([8, 12, 20]);
    expect(queryJsonPath(doc, '$.store..title')).toEqual(['A', 'B']);
    expect(queryJsonPath({ b: { a: { a: 3 } }, a: 1 }, '$..a')).toEqual([{ a: 3 }, 3, 1]);
  });

  it('lists every descendant for ..*', () => {
    expect(queryJsonPath({ x: { y: 1 }, z: [2] }, '$..*')).toEqual([{ y: 1 }, 1, [2], 2]);
  });

  it('resolves .length on arrays and strings', () => {
    expect(queryJsonPath(doc, '$.store.book.length')).toEqual([2]);
    expect(queryJsonPath(doc, `$.store.bicycle.color['length']`)).toEqual([3]);
  });

  it('prefers an own length member and does not invent one for objects', () => {
    expect(queryJsonPath({ length: 'long' }, '$.length')).toEqual(['long']);
    expect(queryJsonPath({ a: 1 }, '$.length')).toEqual([]);
  });

  it('does not use virtual length in recursive descent', () => {
    expect(queryJsonPath({ list: [1, 2] }, '$..length')).toEqual([]);
  });

  it('treats .0 on an array as an index', () => {
    expect(queryJsonPath(doc, 'store.book.0.title')).toEqual(['A']);
    expect(queryJsonPath(doc, 'store.book.01')).toEqual([]);
    expect(queryJsonPath({ 0: 'zero' }, '$.0')).toEqual(['zero']);
  });

  it('does not match keys on primitives or indexes on objects', () => {
    expect(queryJsonPath(doc, '$.count.x')).toEqual([]);
    expect(queryJsonPath(doc, '$.store[0]')).toEqual([]);
  });

  it('never reads inherited properties', () => {
    expect(queryJsonPath({}, '$.constructor')).toEqual([]);
    expect(queryJsonPath({}, '$.toString')).toEqual([]);
    expect(queryJsonPath(JSON.parse('{"__proto__": {"x": 1}}'), '$.__proto__.x')).toEqual([1]);
  });

  it('caps the number of results', () => {
    const big = Array.from({ length: MAX_RESULTS + 5000 }, (_, i) => ({ i }));
    expect(queryJsonPath(big, '$[*]')).toHaveLength(MAX_RESULTS);
    expect(queryJsonPath(big, '$..i')).toHaveLength(MAX_RESULTS);
  });

  it('limits recursion depth on deeply nested JSON', () => {
    const deep = JSON.parse('['.repeat(5000) + ']'.repeat(5000));
    expect(queryJsonPath(deep, '$..*')).toHaveLength(MAX_DEPTH);
  });

  it('throws when a query visits too many values', () => {
    const wide = Array.from({ length: 2001 }, () => new Array<number>(1000).fill(0));
    expect(() => queryJsonPath(wide, '$..nope')).toThrow(/too expensive/);
  });

  it('throws on an invalid path', () => {
    expect(() => queryJsonPath(doc, '$[?(@)]')).toThrow(/not supported/);
  });
});

describe('firstMatch', () => {
  it('returns the first match', () => {
    expect(firstMatch({ a: [5, 6] }, '$.a[*]')).toEqual({ found: true, value: 5 });
  });

  it('tells a matched null apart from no match', () => {
    expect(firstMatch({ a: null }, '$.a')).toEqual({ found: true, value: null });
    expect(firstMatch({ a: null }, '$.b')).toEqual({ found: false, value: undefined });
  });
});

describe('isDefinitePath', () => {
  it('is true only without wildcards and recursive descent', () => {
    expect(isDefinitePath(parseJsonPath('$.a[0].b'))).toBe(true);
    expect(isDefinitePath(parseJsonPath('$.a[*]'))).toBe(false);
    expect(isDefinitePath(parseJsonPath('$..a'))).toBe(false);
  });
});
