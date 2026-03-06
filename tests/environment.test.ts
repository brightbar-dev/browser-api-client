import { describe, it, expect } from 'vitest';
import {
  interpolate, extractVariables, unresolvedVariables,
  newEnvironment, mergeEnvironments,
} from '../utils/environment';

describe('interpolate', () => {
  const vars = [
    { key: 'base_url', value: 'https://api.example.com', enabled: true },
    { key: 'token', value: 'abc123', enabled: true },
    { key: 'disabled', value: 'nope', enabled: false },
  ];

  it('replaces variables', () => {
    expect(interpolate('{{base_url}}/users', vars)).toBe('https://api.example.com/users');
  });

  it('replaces multiple variables', () => {
    expect(interpolate('{{base_url}} with {{token}}', vars)).toBe('https://api.example.com with abc123');
  });

  it('leaves undefined variables unchanged', () => {
    expect(interpolate('{{missing}}', vars)).toBe('{{missing}}');
  });

  it('skips disabled variables', () => {
    expect(interpolate('{{disabled}}', vars)).toBe('{{disabled}}');
  });

  it('handles string with no variables', () => {
    expect(interpolate('plain text', vars)).toBe('plain text');
  });

  it('handles empty template', () => {
    expect(interpolate('', vars)).toBe('');
  });
});

describe('extractVariables', () => {
  it('extracts variable names', () => {
    expect(extractVariables('{{a}} and {{b}} and {{a}}')).toEqual(['a', 'b']);
  });

  it('returns empty for no variables', () => {
    expect(extractVariables('no vars here')).toEqual([]);
  });
});

describe('unresolvedVariables', () => {
  const vars = [
    { key: 'base_url', value: 'https://example.com', enabled: true },
  ];

  it('finds unresolved variables', () => {
    expect(unresolvedVariables('{{base_url}}/{{missing}}', vars)).toEqual(['missing']);
  });

  it('returns empty when all resolved', () => {
    expect(unresolvedVariables('{{base_url}}/path', vars)).toEqual([]);
  });
});

describe('newEnvironment', () => {
  it('creates with defaults', () => {
    const env = newEnvironment('Test');
    expect(env.name).toBe('Test');
    expect(env.variables).toHaveLength(1);
    expect(env.id).toBeTruthy();
  });
});

describe('mergeEnvironments', () => {
  it('overrides base with override', () => {
    const base = { id: '1', name: 'Base', variables: [
      { key: 'url', value: 'http://dev', enabled: true },
      { key: 'key', value: 'dev-key', enabled: true },
    ]};
    const override = { id: '2', name: 'Prod', variables: [
      { key: 'url', value: 'http://prod', enabled: true },
    ]};

    const merged = mergeEnvironments(base, override);
    expect(merged.find(v => v.key === 'url')!.value).toBe('http://prod');
    expect(merged.find(v => v.key === 'key')!.value).toBe('dev-key');
  });
});
