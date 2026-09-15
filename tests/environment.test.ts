import { describe, it, expect } from 'vitest';
import {
  interpolate, extractVariables, unresolvedVariables,
  newEnvironment, mergeEnvironments,
  VARIABLE_NAME_RE, duplicateEnvironment, renameEnvironment, segmentVariables,
} from '../utils/environment';
import type { Environment, EnvVariable } from '../utils/environment';

describe('VARIABLE_NAME_RE', () => {
  it.each(['a', 'base_url', '_private', 'api.key', 'x-token', 'A1.b-c_d', 'user.id.v2'])('accepts %j', name => {
    expect(VARIABLE_NAME_RE.test(name)).toBe(true);
  });

  it.each(['', '1abc', '.a', '-a', 'a b', 'a{', 'a}', ' a', 'a/b', 'é'])('rejects %j', name => {
    expect(VARIABLE_NAME_RE.test(name)).toBe(false);
  });
});

describe('interpolate with wider names and spaces', () => {
  const vars: EnvVariable[] = [
    { key: 'api.key', value: 'K', enabled: true },
    { key: 'x-token', value: 'T', enabled: true },
    { key: 'token', value: 'abc', enabled: true },
    { key: 'dollar', value: '$&$1', enabled: true },
  ];

  it('resolves dotted and dashed names', () => {
    expect(interpolate('{{api.key}}:{{x-token}}', vars)).toBe('K:T');
  });

  it('tolerates spaces and tabs inside the braces', () => {
    expect(interpolate('Bearer {{ token }}', vars)).toBe('Bearer abc');
    expect(interpolate('{{\ttoken  }}', vars)).toBe('abc');
  });

  it('inserts values literally', () => {
    expect(interpolate('{{dollar}}', vars)).toBe('$&$1');
  });

  it('leaves tokens that are not valid names alone', () => {
    expect(interpolate('{{1abc}} {{a b}} {{}} {{ }}', vars)).toBe('{{1abc}} {{a b}} {{}} {{ }}');
    expect(interpolate('{{ missing }}', vars)).toBe('{{ missing }}');
  });
});

describe('extractVariables and unresolvedVariables with wider names', () => {
  it('extracts trimmed, deduplicated names', () => {
    expect(extractVariables('{{ a }} {{a}} {{api.key}} {{x-y}}')).toEqual(['a', 'api.key', 'x-y']);
    expect(extractVariables('{{1abc}}')).toEqual([]);
  });

  it('finds unresolved wider names', () => {
    const vars = [{ key: 'api.key', value: 'k', enabled: true }];
    expect(unresolvedVariables('{{ api.key }}/{{ missing.var }}', vars)).toEqual(['missing.var']);
  });
});

describe('segmentVariables', () => {
  const vars: EnvVariable[] = [
    { key: 'base_url', value: 'https://api.test', enabled: true },
    { key: 'id', value: '7', enabled: false },
    { key: 'token', value: 's3cr3t', enabled: true, secret: true },
  ];

  it('returns nothing for empty text and one text run for plain text', () => {
    expect(segmentVariables('', vars)).toEqual([]);
    expect(segmentVariables('plain', vars)).toEqual([{ kind: 'text', text: 'plain' }]);
  });

  it('splits text and variables, resolving against enabled variables', () => {
    expect(segmentVariables('{{base_url}}/users/{{ id }}?t={{token}}', vars)).toEqual([
      { kind: 'variable', text: '{{base_url}}', name: 'base_url', resolved: true, value: 'https://api.test' },
      { kind: 'text', text: '/users/' },
      { kind: 'variable', text: '{{ id }}', name: 'id', resolved: false },
      { kind: 'text', text: '?t=' },
      { kind: 'variable', text: '{{token}}', name: 'token', resolved: true, value: 's3cr3t', secret: true },
    ]);
  });

  it('does not emit empty text runs between adjacent tokens', () => {
    expect(segmentVariables('{{base_url}}{{nope}}', vars).map(s => s.kind)).toEqual(['variable', 'variable']);
  });

  it.each([
    '{{base_url}}/users/{{ id }}?t={{token}}',
    'a {{{token}}} b',
    '{{ }} {{}} {{1x}} {{a b}}',
    '{{unclosed',
    'closed}} {{token',
    '{{token}}{{token}}\n{{ base_url }}',
  ])('concatenates back to the input: %j', text => {
    expect(segmentVariables(text, vars).map(s => s.text).join('')).toBe(text);
  });
});

describe('duplicateEnvironment', () => {
  const env: Environment = {
    id: 'e1',
    name: 'Dev',
    variables: [
      { key: 'url', value: 'http://dev', enabled: true },
      { key: 'token', value: 't', enabled: false, secret: true },
    ],
  };

  it('copies with a fresh id and "Name copy"', () => {
    const copy = duplicateEnvironment(env);
    expect(copy.id).not.toBe('e1');
    expect(copy.id).toBeTruthy();
    expect(copy.name).toBe('Dev copy');
    expect(copy.variables).toEqual(env.variables);
  });

  it('is a deep copy', () => {
    const copy = duplicateEnvironment(env);
    expect(copy.variables).not.toBe(env.variables);
    copy.variables[0]!.value = 'changed';
    expect(env.variables[0]!.value).toBe('http://dev');
  });
});

describe('renameEnvironment', () => {
  it('renames without mutating', () => {
    const env: Environment = Object.freeze({ id: 'e1', name: 'Dev', variables: [] });
    const r = renameEnvironment(env, 'Prod');
    expect(r).toEqual({ id: 'e1', name: 'Prod', variables: [] });
    expect(env.name).toBe('Dev');
  });
});

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
