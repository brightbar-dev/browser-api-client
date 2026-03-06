/** Request history management. */

import type { ApiRequest, ApiResponse } from './request';

export interface HistoryEntry {
  id: string;
  request: ApiRequest;
  response: ApiResponse;
  timestamp: number;
}

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
