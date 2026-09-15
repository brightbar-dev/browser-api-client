/**
 * Settings → Export / Import. A backup holds only known keys, and importing one
 * validates every record and never writes a key this version does not own.
 */

import type { Environment } from './environment';
import type { Collection } from './collections';
import type { HistoryEntry } from './history';
import { sanitizeCollection, sanitizeEnvironment, sanitizeHistoryEntry, sanitizeList } from './sanitize';

export const BACKUP_FORMAT = 'browser-api-client-backup';
export const BACKUP_VERSION = 2;

export type Theme = 'auto' | 'light' | 'dark';

/** The storage keys a backup may carry. Anything else is ignored on import. */
export const BACKUP_KEYS = ['theme', 'maxHistory', 'requestTimeout', 'environments', 'activeEnvId', 'collections', 'history'] as const;

export interface BackupData {
  theme?: Theme;
  maxHistory?: number;
  /** Seconds, 0 = no limit. */
  requestTimeout?: number;
  environments?: Environment[];
  activeEnvId?: string | null;
  collections?: Collection[];
  history?: HistoryEntry[];
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: BackupData;
}

export const MIN_HISTORY = 10;
export const MAX_HISTORY = 1000;

export function clampRequestTimeout(n: unknown): number {
  const v = typeof n === 'number' ? n : parseInt(String(n), 10);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(600, Math.round(v)));
}

export function clampMaxHistory(n: unknown): number {
  const v = typeof n === 'number' ? n : parseInt(String(n), 10);
  if (!Number.isFinite(v)) return 100;
  return Math.max(MIN_HISTORY, Math.min(MAX_HISTORY, Math.round(v)));
}

function pickData(source: Record<string, unknown>): { data: BackupData; dropped: number } {
  const data: BackupData = {};
  let dropped = 0;
  if (source.theme === 'auto' || source.theme === 'light' || source.theme === 'dark') data.theme = source.theme;
  if (source.maxHistory !== undefined) data.maxHistory = clampMaxHistory(source.maxHistory);
  if (source.requestTimeout !== undefined) data.requestTimeout = clampRequestTimeout(source.requestTimeout);
  if (source.environments !== undefined) {
    const r = sanitizeList(source.environments, sanitizeEnvironment);
    data.environments = r.items;
    dropped += r.dropped;
  }
  if (typeof source.activeEnvId === 'string' || source.activeEnvId === null) data.activeEnvId = source.activeEnvId;
  if (source.collections !== undefined) {
    const r = sanitizeList(source.collections, sanitizeCollection);
    data.collections = r.items;
    dropped += r.dropped;
  }
  if (source.history !== undefined) {
    const r = sanitizeList(source.history, sanitizeHistoryEntry);
    data.history = r.items;
    dropped += r.dropped;
  }
  return { data, dropped };
}

/** Build a backup from what storage holds. */
export function createBackup(storage: Record<string, unknown>, now = new Date()): Backup {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), data: pickData(storage).data };
}

export type ParsedBackup =
  | { ok: true; data: BackupData; ignoredKeys: string[]; dropped: number }
  | { ok: false; error: string };

/**
 * Read a backup file. Accepts this version's format, the older native export
 * (`version: 1` with collections and environments) and the raw storage dump that
 * earlier versions of Settings → Export wrote.
 */
export function parseBackup(text: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, error: 'That file is not a Browser API Client backup.' };
  }
  const obj = json as Record<string, unknown>;

  let source: Record<string, unknown>;
  let ignoredKeys: string[];
  if (obj.format === BACKUP_FORMAT) {
    if (typeof obj.version !== 'number') {
      return { ok: false, error: 'This backup file is damaged: it has no format version.' };
    }
    if (obj.version > BACKUP_VERSION) {
      return { ok: false, error: 'This backup was made by a newer version of Browser API Client. Update the extension and try again.' };
    }
    if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
      return { ok: false, error: 'This backup has no data.' };
    }
    source = obj.data as Record<string, unknown>;
    ignoredKeys = Object.keys(source).filter(k => !(BACKUP_KEYS as readonly string[]).includes(k));
  } else if (obj.version === 1 && Array.isArray(obj.collections) && Array.isArray(obj.environments)) {
    source = { collections: obj.collections, environments: obj.environments };
    ignoredKeys = [];
  } else {
    source = obj;
    ignoredKeys = Object.keys(obj).filter(k => !(BACKUP_KEYS as readonly string[]).includes(k));
  }

  const { data, dropped } = pickData(source);
  if (Object.keys(data).length === 0) {
    return { ok: false, error: 'That file is not a Browser API Client backup: it has no settings, environments, collections or history.' };
  }
  return { ok: true, data, ignoredKeys, dropped };
}

function mergeById<T extends { id: string }>(current: T[] = [], incoming: T[] = []): T[] {
  const incomingIds = new Set(incoming.map(x => x.id));
  return [...incoming, ...current.filter(x => !incomingIds.has(x.id))];
}

/**
 * The storage writes an import makes: settings from the backup, and collections,
 * environments and history merged by id (the backup's copy wins).
 */
export function mergeBackup(current: BackupData, incoming: BackupData): BackupData {
  const out: BackupData = {};
  if (incoming.theme) out.theme = incoming.theme;
  if (incoming.maxHistory !== undefined) out.maxHistory = incoming.maxHistory;
  if (incoming.requestTimeout !== undefined) out.requestTimeout = incoming.requestTimeout;
  if (incoming.environments) out.environments = mergeById(current.environments, incoming.environments);
  if (incoming.collections) out.collections = mergeById(current.collections, incoming.collections);
  if (incoming.history) {
    const limit = incoming.maxHistory ?? current.maxHistory ?? 100;
    out.history = mergeById(current.history, incoming.history)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
  if (incoming.activeEnvId !== undefined) out.activeEnvId = incoming.activeEnvId;
  return out;
}

export function describeImport(data: BackupData, ignoredKeys: string[], dropped: number): string {
  const parts: string[] = [];
  if (data.collections) parts.push(`${data.collections.length} collection${data.collections.length === 1 ? '' : 's'}`);
  if (data.environments) parts.push(`${data.environments.length} environment${data.environments.length === 1 ? '' : 's'}`);
  if (data.history) parts.push(`${data.history.length} history entr${data.history.length === 1 ? 'y' : 'ies'}`);
  if (data.theme || data.maxHistory !== undefined || data.requestTimeout !== undefined) parts.push('settings');
  let msg = `Imported ${parts.join(', ') || 'nothing'}.`;
  if (dropped) msg += ` Skipped ${dropped} malformed record${dropped === 1 ? '' : 's'}.`;
  if (ignoredKeys.length) msg += ` Ignored unknown keys: ${ignoredKeys.join(', ')}.`;
  return msg;
}
