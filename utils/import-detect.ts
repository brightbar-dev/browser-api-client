/**
 * One import box for everything: recognise what was pasted or dropped (a curl command, an
 * OpenAPI/Swagger document, a Postman collection or environment, a HAR file, or one of our
 * backups) and run the matching importer.
 */

import type { ApiRequest } from './request';
import type { Collection } from './collections';
import type { Environment, EnvVariable } from './environment';
import { generateId } from './request';
import { countRequests, newCollection } from './collections';
import { parseCurl } from './curl-import';
import { importOpenApi } from './openapi-import';
import { importPostmanCollectionDetailed } from './import-export';
import { importHar } from './har-import';
import { BACKUP_FORMAT } from './backup';

export type ImportKind = 'curl' | 'openapi' | 'postman-collection' | 'postman-environment' | 'har' | 'backup' | 'unknown';

export interface ImportOutcome {
  kind: Exclude<ImportKind, 'unknown' | 'backup'>;
  collections: Collection[];
  environments: Environment[];
  requests: ApiRequest[];
  warnings: string[];
  summary: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Starts like a curl command: `curl …`, `curl.exe …` or `$ curl …`. */
const CURL_START_RE = /^(?:\$\s+)?curl(?:\.exe)?(?:\s|$)/i;
/** `curl` followed by a URL somewhere on a line (e.g. after `sudo` or a prompt). */
const CURL_INLINE_RE = /\bcurl(?:\.exe)?\s[^\n]*?https?:\/\//i;

function clean(text: string): string {
  return text.replace(/^﻿/, '').trim();
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return nl === -1 ? text : text.slice(0, nl);
}

function detectJson(data: unknown): ImportKind {
  if (!isObj(data)) return 'unknown';
  const isVersion = (v: unknown) => typeof v === 'string' || typeof v === 'number';
  if (isVersion(data.openapi) || isVersion(data.swagger)) return 'openapi';
  const info = data.info;
  if (isObj(info) && ((typeof info.schema === 'string' && info.schema.includes('getpostman.com')) || Array.isArray(data.item))) {
    return 'postman-collection';
  }
  if (data._postman_variable_scope === 'environment' || (Array.isArray(data.values) && typeof data.name === 'string')) {
    return 'postman-environment';
  }
  if (isObj(data.log) && Array.isArray(data.log.entries)) return 'har';
  if (data.format === BACKUP_FORMAT || (data.version === 1 && Array.isArray(data.collections) && Array.isArray(data.environments))) {
    return 'backup';
  }
  return 'unknown';
}

/** What kind of import `text` is. Never throws. */
export function detectImportKind(text: string): ImportKind {
  const src = clean(text);
  if (!src) return 'unknown';
  if (src.startsWith('{') || src.startsWith('[')) {
    try {
      return detectJson(JSON.parse(src));
    } catch {
      return 'unknown';
    }
  }
  if (CURL_START_RE.test(src) || CURL_INLINE_RE.test(firstLine(src))) return 'curl';
  return 'unknown';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function describeCollection(c: Collection): string {
  const folders = c.folders?.length ?? 0;
  const requests = plural(countRequests(c), 'request');
  return `collection “${c.name}” with ${folders > 0 ? `${plural(folders, 'folder')} and ${requests}` : requests}`;
}

function describeEnvironment(env: Environment): string {
  return `environment “${env.name}” with ${plural(env.variables.length, 'variable')}`;
}

function scalar(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** A Postman environment export. Postman's `type: 'secret'` becomes `secret: true`. */
function postmanEnvironment(data: Obj): Environment {
  const variables: EnvVariable[] = [];
  for (const row of Array.isArray(data.values) ? data.values : []) {
    if (!isObj(row)) continue;
    const variable: EnvVariable = { key: scalar(row.key), value: scalar(row.value), enabled: row.enabled !== false };
    if (row.type === 'secret') variable.secret = true;
    variables.push(variable);
  }
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported Environment';
  return { id: generateId(), name, variables };
}

function looksLikeYaml(src: string): boolean {
  if (/^(?:---|%YAML)/.test(src)) return true;
  const lines = src.split('\n').map(l => l.trimEnd()).filter(l => l.trim() && !l.trimStart().startsWith('#'));
  if (!lines[0] || !/^[A-Za-z_][\w.-]*:(?:\s|$)/.test(lines[0])) return false;
  return lines.filter(l => /^\s*(?:- )?[\w.-]+:(?:\s|$)/.test(l)).length >= 2;
}

const WHAT_CAN_BE_IMPORTED =
  'Paste a curl command, an OpenAPI or Swagger document (JSON), a Postman collection or environment, or a HAR file.';

/**
 * Detect and import. Throws an Error with a user-facing message for input that cannot be
 * imported here: unrecognised text, YAML, or a Browser API Client backup (those belong in
 * Settings). Importer errors (e.g. a malformed curl command) pass through.
 */
export function runImport(text: string): ImportOutcome {
  const src = clean(text);
  const kind = detectImportKind(src);

  switch (kind) {
    case 'curl': {
      // Drop anything before `curl` on the first line (a prompt, `sudo`), but keep `$ curl`.
      const at = CURL_START_RE.test(src) ? 0 : src.search(/\bcurl(?:\.exe)?\s/i);
      const { value, warnings } = parseCurl(src.slice(Math.max(0, at)));
      return { kind, collections: [], environments: [], requests: [value], warnings, summary: `Imported request “${value.name}”.` };
    }
    case 'openapi': {
      const { value, warnings } = importOpenApi(src);
      const { collection, variables } = value;
      const environments: Environment[] =
        variables.length > 0 ? [{ id: generateId(), name: collection.name, variables }] : [];
      const summary = `Imported ${describeCollection(collection)}${environments[0] ? `, and ${describeEnvironment(environments[0])}` : ''}.`;
      return { kind, collections: [collection], environments, requests: [], warnings, summary };
    }
    case 'postman-collection': {
      const { value, warnings } = importPostmanCollectionDetailed(src);
      return { kind, collections: [value], environments: [], requests: [], warnings, summary: `Imported ${describeCollection(value)}.` };
    }
    case 'postman-environment': {
      const env = postmanEnvironment(JSON.parse(src) as Obj);
      return { kind, collections: [], environments: [env], requests: [], warnings: [], summary: `Imported ${describeEnvironment(env)}.` };
    }
    case 'har': {
      const { value, warnings } = importHar(src);
      const collection: Collection = { ...newCollection('HAR import'), requests: value };
      return { kind, collections: [collection], environments: [], requests: [], warnings, summary: `Imported ${describeCollection(collection)}.` };
    }
    case 'backup':
      throw new Error('This is a Browser API Client backup — import it from Settings.');
    case 'unknown':
      break;
  }

  if (!src) throw new Error(`Nothing to import. ${WHAT_CAN_BE_IMPORTED}`);
  if (src.startsWith('{') || src.startsWith('[')) {
    try {
      JSON.parse(src);
    } catch (e) {
      throw new Error(`This is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    throw new Error(`This JSON is not a format that can be imported. ${WHAT_CAN_BE_IMPORTED}`);
  }
  if (/^\s*(?:openapi|swagger)\s*:/m.test(src)) {
    throw new Error('This looks like a YAML OpenAPI document. Paste the JSON form of the spec (most tools can export it).');
  }
  if (looksLikeYaml(src)) throw new Error(`This looks like YAML, which cannot be imported. ${WHAT_CAN_BE_IMPORTED}`);
  throw new Error(`This is not something that can be imported. ${WHAT_CAN_BE_IMPORTED}`);
}
