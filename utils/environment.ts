/** Environment variable management for API requests. */

export interface Environment {
  id: string;
  name: string;
  variables: EnvVariable[];
}

export interface EnvVariable {
  key: string;
  value: string;
  enabled: boolean;
}

/** Replace {{variable}} placeholders in a string using environment variables. */
export function interpolate(template: string, variables: EnvVariable[]): string {
  const enabled = variables.filter(v => v.enabled);
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const v = enabled.find(e => e.key === key);
    return v ? v.value : match;
  });
}

/** Extract all {{variable}} names from a string. */
export function extractVariables(str: string): string[] {
  const matches = str.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

/** Check which variables in a template are unresolved (not in the environment). */
export function unresolvedVariables(template: string, variables: EnvVariable[]): string[] {
  const used = extractVariables(template);
  const defined = new Set(variables.filter(v => v.enabled).map(v => v.key));
  return used.filter(v => !defined.has(v));
}

/** Create a new empty environment. */
export function newEnvironment(name = 'New Environment'): Environment {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    variables: [{ key: '', value: '', enabled: true }],
  };
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
