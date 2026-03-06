import { describe, it, expect } from 'vitest';
import {
  sortByRecent, filterByMethod, filterByUrl,
  filterByStatus, truncateHistory, formatTimestamp,
} from '../utils/history';
import type { HistoryEntry } from '../utils/history';

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
    expect(truncated[0].id).toBe('9');
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
