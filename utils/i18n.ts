/**
 * UI strings. Every message lives in public/_locales/<locale>/messages.json; `t()` reads
 * the browser's i18n API and falls back to the bundled English table where that API is
 * missing or silent (Node tests, a page without extension APIs).
 */

import { browser } from 'wxt/browser';
import english from '../public/_locales/en/messages.json';

export interface MessageEntry {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string; example?: string }>;
}

const ENGLISH = english as Record<string, MessageEntry>;

/**
 * Chrome's message formatting: named `$name$` placeholders (case-insensitive) become their
 * `content`, then `$1`..`$9` become substitutions and each run of `$$` loses one `$`.
 * Substituted values are inserted as they are, never re-read for `$`.
 */
export function formatMessage(message: string, subs: ReadonlyArray<string | number> = [], placeholders: MessageEntry['placeholders'] = {}): string {
  const named: Record<string, string> = {};
  for (const [name, p] of Object.entries(placeholders)) named[name.toLowerCase()] = p.content;
  const expanded = message.replace(/\$([A-Za-z0-9_@]+)\$/g, (whole, name: string) => named[name.toLowerCase()] ?? whole);
  return expanded.replace(/\$(?:([1-9])|(\$+))/g, (_, digit: string | undefined, dollars: string | undefined) =>
    digit ? String(subs[Number(digit) - 1] ?? '') : dollars!,
  );
}

function fromBrowser(key: string, subs: string[]): string {
  try {
    const i18n = (typeof browser !== 'undefined' ? browser?.i18n : undefined) as { getMessage?: (name: string, substitutions?: string[]) => string } | undefined;
    if (typeof i18n?.getMessage !== 'function') return '';
    return i18n.getMessage(key, subs) || '';
  } catch {
    return '';
  }
}

/** The localized message for `key`, with `subs` filling its placeholders in order. */
export function t(key: string, ...subs: Array<string | number>): string {
  const strings = subs.map(String);
  const native = fromBrowser(key, strings);
  if (native) return native;
  const entry = ENGLISH[key];
  return entry ? formatMessage(entry.message, strings, entry.placeholders) : key;
}

const SLOT = /(\d+)/;

/**
 * A message split around rich parts: strings and numbers are substituted as text, any
 * other value (an element) comes back in its place, so markup never enters messages.
 */
export function tParts<T>(key: string, ...subs: Array<string | number | T>): Array<string | T> {
  const slots: T[] = [];
  const text = t(
    key,
    ...subs.map((s) => (typeof s === 'string' || typeof s === 'number' ? s : `${slots.push(s) - 1}`)),
  );
  const pieces = text.split(SLOT);
  const out: Array<string | T> = [];
  pieces.forEach((piece, i) => {
    if (i % 2 === 1) out.push(slots[Number(piece)]!);
    else if (piece) out.push(piece);
  });
  return out;
}
