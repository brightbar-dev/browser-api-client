/** Request history management. */

import type { ApiRequest, ApiResponse } from './request';

export interface HistoryEntry {
  id: string;
  request: ApiRequest;
  response: ApiResponse;
  timestamp: number;
}

export interface HistoryGroup {
  /** Local calendar day, `YYYY-MM-DD`. */
  key: string;
  label: string;
  entries: HistoryEntry[];
}

export type StatusFilter = 'all' | '2xx' | '3xx' | '4xx' | '5xx' | 'error';

/** Sort history entries newest first. */
export function sortByRecent(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.timestamp - a.timestamp);
}

/** Filter history by method. */
export function filterByMethod(entries: HistoryEntry[], method: string): HistoryEntry[] {
  return entries.filter(e => e.request.method === method);
}

/** Filter history by URL substring. */
export function filterByUrl(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const q = query.toLowerCase();
  return entries.filter(e => e.request.url.toLowerCase().includes(q));
}

/** Filter history by status code range. */
export function filterByStatus(entries: HistoryEntry[], min: number, max: number): HistoryEntry[] {
  return entries.filter(e => e.response.status >= min && e.response.status <= max);
}

const STATUS_RANGES: Record<Exclude<StatusFilter, 'all' | 'error'>, [number, number]> = {
  '2xx': [200, 299],
  '3xx': [300, 399],
  '4xx': [400, 499],
  '5xx': [500, 599],
};

/**
 * Filter history, keeping order. `query` is a case-insensitive substring of the URL or the
 * request name; `method` 'all' or unset means any; status 'error' means a network failure
 * (status 0).
 */
export function filterHistory(
  entries: HistoryEntry[],
  f: { query?: string; method?: string; status?: StatusFilter },
): HistoryEntry[] {
  const q = (f.query ?? '').trim().toLowerCase();
  const method = f.method && f.method.toLowerCase() !== 'all' ? f.method.toUpperCase() : undefined;
  const status = f.status ?? 'all';
  return entries.filter(e => {
    if (method && e.request.method.toUpperCase() !== method) return false;
    if (status === 'error') {
      if (e.response.status !== 0) return false;
    } else if (status !== 'all') {
      const [min, max] = STATUS_RANGES[status];
      if (e.response.status < min || e.response.status > max) return false;
    }
    if (q && !e.request.url.toLowerCase().includes(q) && !e.request.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const SAME_YEAR = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const OTHER_YEAR = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Group entries by local calendar day, newest day first and newest entry first within a
 * day. Labels are 'Today', 'Yesterday', or e.g. 'Mon, Sep 14' (with the year when it is
 * not the current year).
 */
export function groupByDay(entries: HistoryEntry[], now = Date.now()): HistoryGroup[] {
  const today = new Date(now);
  const todayKey = dayKey(today);
  const yesterdayKey = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));

  const groups: HistoryGroup[] = [];
  const byKey = new Map<string, HistoryGroup>();
  for (const entry of sortByRecent(entries)) {
    const d = new Date(entry.timestamp);
    const valid = Number.isFinite(d.getTime());
    const key = valid ? dayKey(d) : 'unknown';
    let group = byKey.get(key);
    if (!group) {
      let label: string;
      if (!valid) label = 'Unknown date';
      else if (key === todayKey) label = 'Today';
      else if (key === yesterdayKey) label = 'Yesterday';
      else label = (d.getFullYear() === today.getFullYear() ? SAME_YEAR : OTHER_YEAR).format(d);
      group = { key, label, entries: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

/** Truncate history to max entries. */
export function truncateHistory(entries: HistoryEntry[], max: number): HistoryEntry[] {
  const sorted = sortByRecent(entries);
  return sorted.slice(0, max);
}

/** Format timestamp for display. */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - ts;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
