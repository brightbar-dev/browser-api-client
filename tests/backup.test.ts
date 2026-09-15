import { describe, it, expect } from 'vitest';
import {
  createBackup, parseBackup, mergeBackup, describeImport, clampMaxHistory,
  BACKUP_FORMAT, BACKUP_VERSION, BACKUP_KEYS, MIN_HISTORY, MAX_HISTORY,
} from '../utils/backup';
import type { BackupData, ParsedBackup } from '../utils/backup';
import { newRequest } from '../utils/request';
import type { ApiRequest } from '../utils/request';
import type { Environment } from '../utils/environment';
import type { Collection } from '../utils/collections';
import type { HistoryEntry } from '../utils/history';

function request(id: string, url = 'https://api.example.com'): ApiRequest {
  return { ...newRequest(), id, url };
}

function env(id: string, name = 'Dev'): Environment {
  return { id, name, variables: [{ key: 'baseUrl', value: 'https://api.example.com', enabled: true }] };
}

function collection(id: string, name = 'API'): Collection {
  return { id, name, description: '', requests: [request(`${id}-r1`)], created: 1000, updated: 2000 };
}

function entry(id: string, timestamp: number): HistoryEntry {
  return {
    id,
    request: request(`${id}-req`),
    response: { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '{}', size: 2, time: 10, contentType: 'application/json' },
    timestamp,
  };
}

type Ok = Extract<ParsedBackup, { ok: true }>;

function ok(text: string): Ok {
  const r = parseBackup(text);
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r;
}

function err(text: string): string {
  const r = parseBackup(text);
  if (r.ok) throw new Error('expected an error');
  return r.error;
}

const storage = (): Record<string, unknown> => ({
  theme: 'dark',
  maxHistory: 200,
  environments: [env('e1')],
  activeEnvId: 'e1',
  collections: [collection('c1')],
  history: [entry('h1', 100)],
  proUnlocked: true,
  extensionpay_user: { paid: true, email: 'someone@example.com' },
  workspace: { version: 1, tabs: [] },
});

describe('clampMaxHistory', () => {
  it('clamps into range and rounds', () => {
    expect(clampMaxHistory(5)).toBe(MIN_HISTORY);
    expect(clampMaxHistory(99999)).toBe(MAX_HISTORY);
    expect(clampMaxHistory(12.6)).toBe(13);
    expect(clampMaxHistory(250)).toBe(250);
  });

  it('parses numeric strings and defaults anything else to 100', () => {
    expect(clampMaxHistory('250')).toBe(250);
    expect(clampMaxHistory('lots')).toBe(100);
    expect(clampMaxHistory(null)).toBe(100);
    expect(clampMaxHistory(NaN)).toBe(100);
    expect(clampMaxHistory(Infinity)).toBe(100);
  });
});

describe('createBackup', () => {
  it('carries the format, version and export time', () => {
    const b = createBackup({}, new Date('2026-09-14T12:00:00Z'));
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.version).toBe(BACKUP_VERSION);
    expect(b.exportedAt).toBe('2026-09-14T12:00:00.000Z');
    expect(b.data).toEqual({});
  });

  it('picks only known keys', () => {
    const b = createBackup(storage());
    expect(Object.keys(b.data).sort()).toEqual([...BACKUP_KEYS].sort());
    expect(b.data).toEqual({
      theme: 'dark',
      maxHistory: 200,
      environments: [env('e1')],
      activeEnvId: 'e1',
      collections: [collection('c1')],
      history: [entry('h1', 100)],
    });
  });

  it('never includes Pro/payment or workspace keys anywhere in the file', () => {
    const text = JSON.stringify(createBackup(storage()));
    expect(text).not.toContain('proUnlocked');
    expect(text).not.toContain('extensionpay');
    expect(text).not.toContain('someone@example.com');
    expect(text).not.toContain('workspace');
    expect(BACKUP_KEYS as readonly string[]).not.toContain('proUnlocked');
  });

  it('sanitizes what it exports', () => {
    const b = createBackup({ theme: 'neon', maxHistory: 3, environments: [env('e1'), null], activeEnvId: 5 });
    expect(b.data).toEqual({ maxHistory: MIN_HISTORY, environments: [env('e1')] });
  });

  it('keeps a null activeEnvId', () => {
    expect(createBackup({ activeEnvId: null }).data).toEqual({ activeEnvId: null });
  });
});

describe('parseBackup', () => {
  it('reads back what createBackup wrote', () => {
    const b = createBackup(storage());
    const r = ok(JSON.stringify(b));
    expect(r.data).toEqual(b.data);
    expect(r.ignoredKeys).toEqual([]);
    expect(r.dropped).toBe(0);
  });

  it('accepts an older version of the current format', () => {
    const r = ok(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { theme: 'light' } }));
    expect(r.data).toEqual({ theme: 'light' });
  });

  it('lists unknown keys inside data as ignored and does not import them', () => {
    const r = ok(JSON.stringify({ format: BACKUP_FORMAT, version: 2, data: { theme: 'light', proUnlocked: true, workspace: {} } }));
    expect(r.ignoredKeys).toEqual(['proUnlocked', 'workspace']);
    expect(r.data).toEqual({ theme: 'light' });
    expect('proUnlocked' in r.data).toBe(false);
  });

  it('rejects a backup from a newer version', () => {
    expect(err(JSON.stringify({ format: BACKUP_FORMAT, version: 3, data: { theme: 'dark' } }))).toBe(
      'This backup was made by a newer version of Browser API Client. Update the extension and try again.',
    );
  });

  it('rejects the current format with a missing or non-numeric version as damaged', () => {
    expect(err(JSON.stringify({ format: BACKUP_FORMAT, version: '2', data: { theme: 'dark' } }))).toMatch(/damaged/);
    expect(err(JSON.stringify({ format: BACKUP_FORMAT, data: { theme: 'dark' } }))).toMatch(/damaged/);
  });

  it('rejects the current format with missing or non-object data', () => {
    expect(err(JSON.stringify({ format: BACKUP_FORMAT, version: 2 }))).toBe('This backup has no data.');
    expect(err(JSON.stringify({ format: BACKUP_FORMAT, version: 2, data: [] }))).toBe('This backup has no data.');
    expect(err(JSON.stringify({ format: BACKUP_FORMAT, version: 2, data: 'x' }))).toBe('This backup has no data.');
  });

  it('reads the v1 native export', () => {
    const r = ok(JSON.stringify({ version: 1, exportedAt: '2025-01-01T00:00:00Z', collections: [collection('c1')], environments: [env('e1')], history: [entry('h', 1)] }));
    expect(r.data).toEqual({ collections: [collection('c1')], environments: [env('e1')] });
    expect(r.ignoredKeys).toEqual([]);
    expect(r.dropped).toBe(0);
  });

  it('reads a v1 native export with empty lists', () => {
    const r = ok(JSON.stringify({ version: 1, collections: [], environments: [] }));
    expect(r.data).toEqual({ collections: [], environments: [] });
  });

  it('reads a legacy raw storage dump and lists its unknown keys', () => {
    const r = ok(JSON.stringify(storage()));
    expect(r.data).toEqual({
      theme: 'dark',
      maxHistory: 200,
      environments: [env('e1')],
      activeEnvId: 'e1',
      collections: [collection('c1')],
      history: [entry('h1', 100)],
    });
    expect(r.ignoredKeys).toEqual(['proUnlocked', 'extensionpay_user', 'workspace']);
  });

  it('rejects non-JSON', () => {
    expect(err('not json {')).toBe('That file is not valid JSON.');
    expect(err('')).toBe('That file is not valid JSON.');
  });

  it.each(['[]', '[{"theme":"dark"}]', 'null', '42', '"backup"', 'true'])('rejects the non-object JSON %s', text => {
    expect(err(text)).toBe('That file is not a Browser API Client backup.');
  });

  it('rejects an object with no known keys', () => {
    const message = 'That file is not a Browser API Client backup: it has no settings, environments, collections or history.';
    expect(err('{}')).toBe(message);
    expect(err(JSON.stringify({ proUnlocked: true, extensionpay_user: {} }))).toBe(message);
    expect(err(JSON.stringify({ info: { name: 'Postman' }, item: [] }))).toBe(message);
    expect(err(JSON.stringify({ format: BACKUP_FORMAT, version: 2, data: { proUnlocked: true } }))).toBe(message);
  });

  it('rejects an object whose only known keys are invalid', () => {
    expect(err(JSON.stringify({ theme: 'neon', activeEnvId: 5 }))).toMatch(/not a Browser API Client backup/);
  });

  it('counts malformed records in dropped and keeps the rest', () => {
    const r = ok(JSON.stringify({
      format: BACKUP_FORMAT,
      version: 2,
      data: {
        environments: [env('e1'), null, 'x'],
        collections: [collection('c1'), 5],
        history: [entry('h1', 1), { id: 'h2', request: null }, { id: 'h3' }],
      },
    }));
    expect(r.dropped).toBe(5);
    expect(r.data.environments).toHaveLength(1);
    expect(r.data.collections).toHaveLength(1);
    expect(r.data.history).toHaveLength(1);
  });

  it('keeps an empty list when every record is malformed', () => {
    const r = ok(JSON.stringify({ environments: [null, 1] }));
    expect(r.data).toEqual({ environments: [] });
    expect(r.dropped).toBe(2);
  });

  it.each<[unknown, number]>([[5, 10], [99999, 1000], ['250', 250], ['lots', 100], [50.4, 50]])(
    'clamps maxHistory %j to %d',
    (maxHistory, expected) => {
      expect(ok(JSON.stringify({ maxHistory })).data.maxHistory).toBe(expected);
    },
  );

  it('keeps activeEnvId null and drops a non-string one', () => {
    expect(ok(JSON.stringify({ theme: 'auto', activeEnvId: null })).data).toEqual({ theme: 'auto', activeEnvId: null });
    expect(ok(JSON.stringify({ theme: 'auto', activeEnvId: 5 })).data).toEqual({ theme: 'auto' });
  });
});

describe('mergeBackup', () => {
  it('merges environments and collections by id, the backup winning and coming first', () => {
    const current: BackupData = { environments: [env('e1', 'Old'), env('e2', 'Keep')], collections: [collection('c1', 'Old'), collection('c2', 'Keep')] };
    const incoming: BackupData = { environments: [env('e3', 'New'), env('e1', 'Updated')], collections: [collection('c1', 'Updated')] };
    const out = mergeBackup(current, incoming);
    expect(out.environments!.map(e => [e.id, e.name])).toEqual([['e3', 'New'], ['e1', 'Updated'], ['e2', 'Keep']]);
    expect(out.collections!.map(c => [c.id, c.name])).toEqual([['c1', 'Updated'], ['c2', 'Keep']]);
  });

  it('works when current has none', () => {
    expect(mergeBackup({}, { environments: [env('e1')] }).environments).toEqual([env('e1')]);
  });

  it('merges history by id newest-first and trims to the backup maxHistory', () => {
    const updated = { ...entry('h2', 300), response: { ...entry('h2', 300).response, status: 404 } };
    const out = mergeBackup(
      { maxHistory: 100, history: [entry('h1', 100), entry('h2', 300)] },
      { maxHistory: 2, history: [entry('h3', 200), updated] },
    );
    expect(out.history!.map(h => h.id)).toEqual(['h2', 'h3']);
    expect(out.history![0]!.response.status).toBe(404);
    expect(out.maxHistory).toBe(2);
  });

  it('trims history to the current maxHistory when the backup has none', () => {
    const out = mergeBackup({ maxHistory: 1, history: [entry('h1', 100)] }, { history: [entry('h2', 50)] });
    expect(out.history!.map(h => h.id)).toEqual(['h1']);
    expect('maxHistory' in out).toBe(false);
  });

  it('trims history to 100 when neither side sets maxHistory', () => {
    const incoming = Array.from({ length: 150 }, (_, i) => entry(`h${i}`, i));
    const out = mergeBackup({}, { history: incoming });
    expect(out.history).toHaveLength(100);
    expect(out.history![0]!.id).toBe('h149');
    expect(out.history![99]!.id).toBe('h50');
  });

  it('only writes what the backup carries', () => {
    const current: BackupData = { theme: 'dark', maxHistory: 50, environments: [env('e1')], collections: [collection('c1')], history: [entry('h1', 1)], activeEnvId: 'e1' };
    expect(mergeBackup(current, {})).toEqual({});
    expect(mergeBackup(current, { theme: 'light' })).toEqual({ theme: 'light' });
  });

  it('carries activeEnvId, including null', () => {
    expect(mergeBackup({ activeEnvId: 'e1' }, { activeEnvId: null })).toEqual({ activeEnvId: null });
    expect(mergeBackup({ activeEnvId: 'e1' }, { activeEnvId: 'e2' })).toEqual({ activeEnvId: 'e2' });
  });

  it('does not mutate its inputs', () => {
    const current: BackupData = { history: [entry('h1', 1), entry('h2', 2)] };
    const incoming: BackupData = { history: [entry('h3', 3)] };
    const snapshot = JSON.stringify([current, incoming]);
    mergeBackup(current, incoming);
    expect(JSON.stringify([current, incoming])).toBe(snapshot);
  });
});

describe('describeImport', () => {
  it('lists everything imported with plurals', () => {
    const data: BackupData = { collections: [collection('a'), collection('b')], environments: [env('e')], history: [entry('1', 1), entry('2', 2), entry('3', 3)], theme: 'dark' };
    expect(describeImport(data, [], 0)).toBe('Imported 2 collections, 1 environment, 3 history entries, settings.');
  });

  it('uses the singular forms', () => {
    expect(describeImport({ collections: [collection('a')], environments: [env('e'), env('f')], history: [entry('1', 1)] }, [], 0))
      .toBe('Imported 1 collection, 2 environments, 1 history entry.');
  });

  it('counts empty lists and treats maxHistory alone as settings', () => {
    expect(describeImport({ collections: [] }, [], 0)).toBe('Imported 0 collections.');
    expect(describeImport({ maxHistory: 50 }, [], 0)).toBe('Imported settings.');
  });

  it('says nothing was imported when nothing countable was', () => {
    expect(describeImport({}, [], 0)).toBe('Imported nothing.');
    expect(describeImport({ activeEnvId: 'e1' }, [], 0)).toBe('Imported nothing.');
  });

  it('mentions skipped malformed records', () => {
    expect(describeImport({ theme: 'light' }, [], 1)).toBe('Imported settings. Skipped 1 malformed record.');
    expect(describeImport({ theme: 'light' }, [], 3)).toBe('Imported settings. Skipped 3 malformed records.');
  });

  it('mentions ignored unknown keys', () => {
    expect(describeImport({ environments: [env('e')] }, ['proUnlocked', 'workspace'], 2)).toBe(
      'Imported 1 environment. Skipped 2 malformed records. Ignored unknown keys: proUnlocked, workspace.',
    );
  });

  it('describes a parsed legacy dump end to end', () => {
    const r = ok(JSON.stringify(storage()));
    expect(describeImport(r.data, r.ignoredKeys, r.dropped)).toBe(
      'Imported 1 collection, 1 environment, 1 history entry, settings. Ignored unknown keys: proUnlocked, extensionpay_user, workspace.',
    );
  });
});
