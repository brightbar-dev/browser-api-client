import { describe, it, expect } from 'vitest';
import {
  sortByRecent, filterByMethod, filterByUrl,
  filterByStatus, truncateHistory, formatTimestamp,
  groupByDay, filterHistory,
} from '../utils/history';
import type { HistoryEntry, StatusFilter } from '../utils/history';

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'test',
  request: {
    id: 'r1', name: 'Test', method: 'GET', url: 'https://api.example.com',
    headers: [], params: [], body: '', bodyType: 'none', auth: { type: 'none' },
  },
  response: {
    status: 200, statusText: 'OK', headers: {}, body: '', size: 0, time: 100,
    contentType: 'application/json',
  },
  timestamp: Date.now(),
  ...overrides,
});

describe('sortByRecent', () => {
  it('sorts newest first', () => {
    const entries = [
      makeEntry({ id: 'old', timestamp: 1000 }),
      makeEntry({ id: 'new', timestamp: 3000 }),
      makeEntry({ id: 'mid', timestamp: 2000 }),
    ];
    const sorted = sortByRecent(entries);
    expect(sorted.map(e => e.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('filterByMethod', () => {
  it('filters by method', () => {
    const entries = [
      makeEntry({ id: 'get', request: { ...makeEntry().request, method: 'GET' } }),
      makeEntry({ id: 'post', request: { ...makeEntry().request, method: 'POST' } }),
    ];
    expect(filterByMethod(entries, 'GET').map(e => e.id)).toEqual(['get']);
  });
});

describe('filterByUrl', () => {
  it('filters by URL substring', () => {
    const entries = [
      makeEntry({ id: 'match', request: { ...makeEntry().request, url: 'https://api.example.com/users' } }),
      makeEntry({ id: 'no', request: { ...makeEntry().request, url: 'https://other.com' } }),
    ];
    expect(filterByUrl(entries, 'example').map(e => e.id)).toEqual(['match']);
  });

  it('is case insensitive', () => {
    const entries = [
      makeEntry({ id: 'a', request: { ...makeEntry().request, url: 'https://API.Example.com' } }),
    ];
    expect(filterByUrl(entries, 'api.example')).toHaveLength(1);
  });
});

describe('filterByStatus', () => {
  it('filters by status range', () => {
    const entries = [
      makeEntry({ id: 'ok', response: { ...makeEntry().response, status: 200 } }),
      makeEntry({ id: 'err', response: { ...makeEntry().response, status: 404 } }),
    ];
    expect(filterByStatus(entries, 200, 299).map(e => e.id)).toEqual(['ok']);
  });
});

describe('truncateHistory', () => {
  it('keeps max entries, newest first', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: String(i), timestamp: i * 1000 })
    );
    const truncated = truncateHistory(entries, 3);
    expect(truncated).toHaveLength(3);
    expect(truncated[0]!.id).toBe('9');
  });
});

describe('groupByDay', () => {
  // Local time throughout, so the result does not depend on the machine's timezone.
  const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min).getTime();
  const now = at(2026, 8, 14, 15); // Mon, Sep 14 2026, 15:00

  it('returns no groups for no entries', () => {
    expect(groupByDay([], now)).toEqual([]);
  });

  it('groups newest day first with Today, Yesterday and dated labels', () => {
    const entries = [
      makeEntry({ id: 'sep12', timestamp: at(2026, 8, 12, 10) }),
      makeEntry({ id: 'today-early', timestamp: at(2026, 8, 14, 0, 30) }),
      makeEntry({ id: 'dec31', timestamp: at(2025, 11, 31, 12) }),
      makeEntry({ id: 'yesterday-late', timestamp: at(2026, 8, 13, 23, 59) }),
      makeEntry({ id: 'today-late', timestamp: at(2026, 8, 14, 14) }),
      makeEntry({ id: 'yesterday-early', timestamp: at(2026, 8, 13, 0, 1) }),
    ];
    const groups = groupByDay(entries, now);
    expect(groups.map(g => [g.key, g.label])).toEqual([
      ['2026-09-14', 'Today'],
      ['2026-09-13', 'Yesterday'],
      ['2026-09-12', 'Sat, Sep 12'],
      ['2025-12-31', 'Wed, Dec 31, 2025'],
    ]);
    expect(groups.map(g => g.entries.map(e => e.id))).toEqual([
      ['today-late', 'today-early'],
      ['yesterday-late', 'yesterday-early'],
      ['sep12'],
      ['dec31'],
    ]);
  });

  it('crosses month and year boundaries', () => {
    const newYear = at(2027, 0, 1, 9);
    const groups = groupByDay([
      makeEntry({ id: 'a', timestamp: at(2026, 11, 31, 22) }),
      makeEntry({ id: 'b', timestamp: at(2026, 11, 30, 8) }),
    ], newYear);
    expect(groups.map(g => [g.key, g.label])).toEqual([
      ['2026-12-31', 'Yesterday'],
      ['2026-12-30', 'Wed, Dec 30, 2026'],
    ]);
    expect(groupByDay([makeEntry({ timestamp: at(2026, 8, 30, 12) })], at(2026, 9, 1, 1))[0]!.label).toBe('Yesterday');
  });

  it('zero-pads the key and omits the year in the current year', () => {
    const groups = groupByDay([makeEntry({ timestamp: at(2026, 0, 5, 12) })], now);
    expect(groups[0]!.key).toBe('2026-01-05');
    expect(groups[0]!.label).toBe('Mon, Jan 5');
  });

  it('does not mutate the input order', () => {
    const entries = [makeEntry({ id: 'old', timestamp: at(2026, 8, 1, 1) }), makeEntry({ id: 'new', timestamp: at(2026, 8, 14, 1) })];
    groupByDay(entries, now);
    expect(entries.map(e => e.id)).toEqual(['old', 'new']);
  });

  it('defaults now to the current time', () => {
    expect(groupByDay([makeEntry({ timestamp: Date.now() })])[0]!.label).toBe('Today');
  });
});

describe('filterHistory', () => {
  const entry = (id: string, method: HistoryEntry['request']['method'], status: number, name: string, url: string) =>
    makeEntry({
      id,
      request: { ...makeEntry().request, method, name, url },
      response: { ...makeEntry().response, status },
    });
  const entries = [
    entry('a', 'GET', 200, 'List users', 'https://api.test/users'),
    entry('b', 'POST', 201, 'Create user', 'https://api.test/users'),
    entry('c', 'GET', 302, 'Old link', 'https://api.test/old'),
    entry('d', 'GET', 404, 'Missing', 'https://api.test/nope'),
    entry('e', 'DELETE', 503, 'Boom', 'https://api.test/boom'),
    entry('f', 'GET', 0, 'Offline', 'https://down.example'),
  ];
  const run = (f: Parameters<typeof filterHistory>[1]) => filterHistory(entries, f).map(e => e.id);

  it('keeps everything, in order, with no filters', () => {
    expect(run({})).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(run({ query: '', method: 'all', status: 'all' })).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(run({ query: '   ' })).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('matches the query against URL or name, case-insensitively', () => {
    expect(run({ query: 'USERS' })).toEqual(['a', 'b']);
    expect(run({ query: 'offline' })).toEqual(['f']);
    expect(run({ query: 'down.EXAMPLE' })).toEqual(['f']);
  });

  it('filters by method', () => {
    expect(run({ method: 'POST' })).toEqual(['b']);
    expect(run({ method: 'delete' })).toEqual(['e']);
    expect(run({ method: 'PATCH' })).toEqual([]);
  });

  it.each<[StatusFilter, string[]]>([
    ['2xx', ['a', 'b']],
    ['3xx', ['c']],
    ['4xx', ['d']],
    ['5xx', ['e']],
    ['error', ['f']],
  ])('filters status %s', (status, expected) => {
    expect(run({ status })).toEqual(expected);
  });

  it('combines filters', () => {
    expect(run({ query: 'api.test', method: 'GET', status: '2xx' })).toEqual(['a']);
    expect(run({ query: 'user', status: '4xx' })).toEqual([]);
  });
});

describe('formatTimestamp', () => {
  it('formats just now', () => {
    expect(formatTimestamp(Date.now())).toBe('Just now');
  });

  it('formats minutes ago', () => {
    expect(formatTimestamp(Date.now() - 5 * 60000)).toBe('5m ago');
  });

  it('formats hours ago', () => {
    expect(formatTimestamp(Date.now() - 3 * 3600000)).toBe('3h ago');
  });
});
