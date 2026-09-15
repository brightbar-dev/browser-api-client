/** Environment variable management for API requests. */

import { generateId } from './request';

export interface Environment {
  id: string;
  name: string;
  variables: EnvVariable[];
}

export interface EnvVariable {
  key: string;
  value: string;
  enabled: boolean;
  /** Masked in the UI. */
  secret?: boolean;
}

/** A valid variable name: a letter or `_`, then letters, digits, `_`, `.` or `-`. */
export const VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** A `{{name}}` token. Spaces or tabs just inside the braces are allowed. Group 1 is the name. */
const TOKEN_RE = /\{\{[ \t]*([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*\}\}/g;

/** Replace {{variable}} placeholders in a string using environment variables. */
export function interpolate(template: string, variables: EnvVariable[]): string {
  const enabled = variables.filter(v => v.enabled);
  return template.replace(TOKEN_RE, (match, key: string) => {
    const v = enabled.find(e => e.key === key);
    return v ? v.value : match;
  });
}

/** Extract all {{variable}} names from a string. */
export function extractVariables(str: string): string[] {
  return [...new Set([...str.matchAll(TOKEN_RE)].map(m => m[1]!))];
}

/** Check which variables in a template are unresolved (not in the environment). */
export function unresolvedVariables(template: string, variables: EnvVariable[]): string[] {
  const used = extractVariables(template);
  const defined = new Set(variables.filter(v => v.enabled).map(v => v.key));
  return used.filter(v => !defined.has(v));
}

export type VariableSegment =
  | { kind: 'text'; text: string }
  | { kind: 'variable'; text: string; name: string; resolved: boolean; value?: string; secret?: boolean };

/**
 * Split text into plain runs and `{{var}}` tokens, for highlighting. A variable segment's
 * `text` is the raw token including braces; it is `resolved` when an enabled variable has
 * that name, and then carries `value` (and `secret: true` for secret variables).
 * Concatenating every segment's `text` gives back the input exactly.
 */
export function segmentVariables(text: string, variables: EnvVariable[]): VariableSegment[] {
  const enabled = variables.filter(v => v.enabled);
  const segments: VariableSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    const name = m[1]!;
    const v = enabled.find(e => e.key === name);
    const segment: Extract<VariableSegment, { kind: 'variable' }> = { kind: 'variable', text: m[0], name, resolved: !!v };
    if (v) {
      segment.value = v.value;
      if (v.secret) segment.secret = true;
    }
    segments.push(segment);
    last = start + m[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/** Create a new empty environment. */
export function newEnvironment(name = 'New Environment'): Environment {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    variables: [{ key: '', value: '', enabled: true }],
  };
}

/** A deep copy with a fresh id, named "Name copy". */
export function duplicateEnvironment(env: Environment): Environment {
  return { ...env, id: generateId(), name: `${env.name} copy`, variables: env.variables.map(v => ({ ...v })) };
}

export function renameEnvironment(env: Environment, name: string): Environment {
  return { ...env, name };
}

/** Merge two environments (override wins). */
export function mergeEnvironments(base: Environment, override: Environment): EnvVariable[] {
  const merged = new Map<string, EnvVariable>();
  for (const v of base.variables) {
    if (v.enabled && v.key) merged.set(v.key, v);
  }
  for (const v of override.variables) {
    if (v.enabled && v.key) merged.set(v.key, v);
  }
  return [...merged.values()];
}
