import { afterEach, describe, it, expect, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import english from '../public/_locales/en/messages.json';
import { formatMessage, t, tParts, type MessageEntry } from '../utils/i18n';

const MESSAGES = english as Record<string, MessageEntry>;
/** Used only by the manifest (`__MSG_appName__`), so they may be absent from the code. */
const MANIFEST_KEYS = new Set(['appName', 'appDescription']);
/** Files that pass keys through rather than naming them. */
const DYNAMIC_KEY_FILES = new Set(['utils/i18n.ts', 'entrypoints/options/main.ts']);

// Every source file's text, read at test time without Node's fs (Vite needs the options inline).
const asFiles = (glob: Record<string, unknown>) => Object.entries(glob).map(([path, text]) => ({ path: path.replace(/^\.\.\//, ''), text: text as string }));
const sources = asFiles(
  import.meta.glob(['../entrypoints/**/*.ts', '../entrypoints/**/*.tsx', '../utils/**/*.ts'], { query: '?raw', import: 'default', eager: true }),
);
const pages = asFiles(import.meta.glob('../entrypoints/**/*.html', { query: '?raw', import: 'default', eager: true }));

const LITERAL_CALL = /\bt(?:Parts)?(?:<[^>(]*>)?\(\s*(['"])([^'"]*)\1/g;
const NON_LITERAL_CALL = /\bt(?:Parts)?(?:<[^>(]*>)?\((?!\s*['"])/g;

function usedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  const add = (key: string, where: string) => used.set(key, [...(used.get(key) ?? []), where]);
  for (const { path, text } of sources) for (const m of text.matchAll(LITERAL_CALL)) add(m[2]!, path);
  for (const { path, text } of pages) for (const m of text.matchAll(/data-i18n="([^"]*)"/g)) add(m[1]!, path);
  return used;
}

const placeholderNames = (message: string) => [...message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) => m[1]!.toLowerCase());

describe('formatMessage', () => {
  it('fills $1..$9 in order and leaves missing ones empty', () => {
    expect(formatMessage('$1 of $2', ['3', 7])).toBe('3 of 7');
    expect(formatMessage('a$3b', ['x'])).toBe('ab');
  });

  it('replaces named placeholders with their content, ignoring case', () => {
    const placeholders = { collection: { content: '$1' }, brand: { content: 'Browser API Client' } };
    expect(formatMessage('Saved to “$COLLECTION$” in $Brand$', ['Pets'], placeholders)).toBe('Saved to “Pets” in Browser API Client');
  });

  it('turns $$ into $ and never treats it as a placeholder', () => {
    expect(formatMessage('Costs $$5', [])).toBe('Costs $5');
    expect(formatMessage('$$1 is literal, $1 is not', ['x'])).toBe('$1 is literal, x is not');
    expect(formatMessage('$$$', [])).toBe('$$');
  });

  it('does not read substituted values for placeholders', () => {
    expect(formatMessage('Path: $PATH$', ['$.data[0] $1 $$'], { path: { content: '$1' } })).toBe('Path: $.data[0] $1 $$');
  });

  it('keeps an unknown $name$ as typed', () => {
    expect(formatMessage('Hi $WHO$', ['x'], {})).toBe('Hi $WHO$');
  });
});

describe('t', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to English where the browser has no i18n', () => {
    expect(t('errorCouldNotConnectTitle')).toBe('Could not connect');
    expect(t('saveSavedTo', 'My API')).toBe('Saved to “My API”');
    expect(t('responseSomeTestsFailed', 2, 5)).toBe('2 of 5 tests failed');
  });

  it('prefers browser.i18n.getMessage, passing substitutions as strings', () => {
    const getMessage = vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(((key: string, subs?: string[]) => `[${key}:${(subs ?? []).join('|')}]`) as never);
    expect(t('responseMatchCount', 1, '5000+')).toBe('[responseMatchCount:1|5000+]');
    expect(getMessage).toHaveBeenCalledWith('responseMatchCount', ['1', '5000+']);
  });

  it('uses English when the browser returns an empty string', () => {
    vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation((() => '') as never);
    expect(t('commonCancel')).toBe('Cancel');
  });

  it('returns the key itself for an unknown key', () => {
    expect(t('noSuchKeyAnywhere')).toBe('noSuchKeyAnywhere');
  });
});

describe('tParts', () => {
  it('puts non-text values where their placeholders are', () => {
    const strong = { el: 'strong' };
    const kbd = { el: 'kbd' };
    expect(tParts('responseWelcomeSample', strong, 'Send', kbd)).toEqual([
      'The tab above is a sample request to ',
      strong,
      ', a public echo service. Nothing is sent until you press Send or ',
      kbd,
      '.',
    ]);
  });

  it('drops empty text around a leading slot', () => {
    const key = { el: 'kbd' };
    expect(tParts('responseWelcomeShortcutsLink', key)).toEqual([key, ' for keyboard shortcuts']);
  });
});

describe('messages.json', () => {
  const keys = Object.keys(MESSAGES);

  it('uses only key names Chrome accepts, unique ignoring case', () => {
    for (const key of keys) expect(key, key).toMatch(/^[A-Za-z0-9_]+$/);
    const lower = keys.map((k) => k.toLowerCase());
    expect(lower.filter((k, i) => lower.indexOf(k) !== i)).toEqual([]);
  });

  it('defines every $name$ a message uses, uses every placeholder it defines, and fills them with $1..$9', () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      const defined = Object.keys(entry.placeholders ?? {}).map((n) => n.toLowerCase());
      const used = placeholderNames(entry.message);
      expect(used.filter((n) => !defined.includes(n)), `${key}: undefined placeholders`).toEqual([]);
      expect(defined.filter((n) => !used.includes(n)), `${key}: unused placeholders`).toEqual([]);
      for (const [name, p] of Object.entries(entry.placeholders ?? {})) expect(p.content, `${key}.${name}`).toMatch(/^\$[1-9]$/);
    }
  });

  it('describes every UI message and keeps edge whitespace out of messages', () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      expect(entry.message.trim(), `${key} has edge whitespace`).toBe(entry.message);
      expect(entry.message, key).not.toBe('');
      if (!MANIFEST_KEYS.has(key)) expect(entry.description?.trim(), `${key} needs a description`).toBeTruthy();
    }
  });
});

describe('message keys in the code', () => {
  const used = usedKeys();

  it('finds keys to check', () => {
    expect(used.size).toBeGreaterThan(100);
  });

  it('names only keys that exist in messages.json', () => {
    const missing = [...used].filter(([key]) => !(key in MESSAGES)).map(([key, where]) => `${key} (${[...new Set(where)].join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('leaves no message unused', () => {
    expect(Object.keys(MESSAGES).filter((key) => !MANIFEST_KEYS.has(key) && !used.has(key))).toEqual([]);
  });

  it('passes literal keys everywhere except the helpers that forward them', () => {
    const dynamic = sources
      .filter(({ path }) => !DYNAMIC_KEY_FILES.has(path))
      .flatMap(({ path, text }) => [...text.matchAll(NON_LITERAL_CALL)].map((m) => `${path}:${text.slice(0, m.index).split('\n').length}`));
    expect(dynamic).toEqual([]);
  });
});
