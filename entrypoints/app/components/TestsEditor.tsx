import type { ApiRequest } from '@/utils/request';
import type { Assertion, AssertionOp, AssertionSource, Extraction } from '@/utils/assertions';
import { isValidVariableName, newAssertion, newExtraction, opsForSource } from '@/utils/assertions';
import { useApp } from '../store';
import { IconClose, IconPlus } from './icons';

const SOURCE_LABELS: Record<AssertionSource, string> = {
  status: 'Status code',
  header: 'Header',
  jsonpath: 'JSON body path',
  body: 'Body text',
  time: 'Response time (ms)',
};

const OP_LABELS: Record<AssertionOp, string> = {
  equals: 'equals',
  'not-equals': 'does not equal',
  exists: 'exists',
  'not-exists': 'does not exist',
  contains: 'contains',
  'not-contains': 'does not contain',
  lt: 'is less than',
  lte: 'is at most',
  gt: 'is greater than',
  gte: 'is at least',
  matches: 'matches regex',
  'type-is': 'is of type',
};

const EXTRACT_LABELS: Record<Extraction['source'], string> = {
  jsonpath: 'JSON body path',
  header: 'Header',
  status: 'Status code',
  body: 'Whole body',
};

const needsPath = (source: string) => source === 'header' || source === 'jsonpath';
const needsExpected = (op: AssertionOp) => op !== 'exists' && op !== 'not-exists';

interface TestsEditorProps {
  request: ApiRequest;
  update: (fn: (r: ApiRequest) => ApiRequest) => void;
}

export function TestsEditor({ request, update }: TestsEditorProps) {
  const envName = useApp((s) => s.environments.find((e) => e.id === s.activeEnvId)?.name);
  const assertions = request.assertions ?? [];
  const extractions = request.extractions ?? [];
  const setAssertions = (list: Assertion[]) => update((r) => ({ ...r, assertions: list }));
  const setExtractions = (list: Extraction[]) => update((r) => ({ ...r, extractions: list }));
  const patchAssertion = (i: number, patch: Partial<Assertion>) => setAssertions(assertions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const patchExtraction = (i: number, patch: Partial<Extraction>) => setExtractions(extractions.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div class="bac-tests-editor">
      <section class="bac-rule-section" aria-labelledby="bac-tests-title">
        <header class="bac-rule-head">
          <h3 id="bac-tests-title">Tests</h3>
          <span class="bac-muted bac-small">Checked on every response. Each row is a rule — no scripts to write.</span>
          <div class="bac-spacer" />
          <button type="button" class="bac-btn bac-btn-small" onClick={() => setAssertions([...assertions, newAssertion(assertions.length ? 'jsonpath' : 'status')])}>
            <IconPlus /> Add test
          </button>
        </header>
        {assertions.length === 0 ? (
          <p class="bac-muted bac-small">
            No tests yet.{' '}
            <button type="button" class="bac-link-btn" onClick={() => setAssertions([{ ...newAssertion('status'), op: 'equals', expected: '200' }])}>
              Add “status code equals 200”
            </button>
          </p>
        ) : (
          <div class="bac-rules bac-rules-tests" role="table" aria-label="Tests">
            {assertions.map((a, i) => {
              const ops = opsForSource(a.source);
              return (
                <div key={a.id} role="row" class={`bac-rule${a.enabled ? '' : ' is-disabled'}`}>
                  <span role="cell">
                    <input type="checkbox" checked={a.enabled} aria-label={`Run test ${i + 1}`} onChange={(e) => patchAssertion(i, { enabled: e.currentTarget.checked })} />
                  </span>
                  <span role="cell">
                    <select
                      class="bac-select"
                      aria-label={`What test ${i + 1} checks`}
                      value={a.source}
                      onChange={(e) => {
                        const source = e.currentTarget.value as AssertionSource;
                        const fresh = newAssertion(source);
                        patchAssertion(i, { source, op: fresh.op, path: needsPath(source) ? a.path : '', expected: fresh.expected || a.expected });
                      }}
                    >
                      {Object.entries(SOURCE_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span role="cell">
                    {needsPath(a.source) ? (
                      <input
                        class="bac-input bac-mono"
                        aria-label={a.source === 'header' ? `Header name for test ${i + 1}` : `JSON path for test ${i + 1}`}
                        placeholder={a.source === 'header' ? 'Content-Type' : '$.data[0].id'}
                        value={a.path}
                        spellcheck={false}
                        onInput={(e) => patchAssertion(i, { path: e.currentTarget.value })}
                      />
                    ) : (
                      <span class="bac-muted bac-small">—</span>
                    )}
                  </span>
                  <span role="cell">
                    <select class="bac-select" aria-label={`Condition for test ${i + 1}`} value={a.op} onChange={(e) => patchAssertion(i, { op: e.currentTarget.value as AssertionOp })}>
                      {ops.map((op) => (
                        <option key={op} value={op}>
                          {OP_LABELS[op]}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span role="cell">
                    {needsExpected(a.op) ? (
                      <input
                        class="bac-input bac-mono"
                        aria-label={`Expected value for test ${i + 1}`}
                        placeholder={a.op === 'type-is' ? 'string, number, array…' : a.op === 'matches' ? '^ok$' : '200'}
                        value={a.expected}
                        spellcheck={false}
                        onInput={(e) => patchAssertion(i, { expected: e.currentTarget.value })}
                      />
                    ) : (
                      <span />
                    )}
                  </span>
                  <span role="cell">
                    <button type="button" class="bac-icon-btn" aria-label={`Remove test ${i + 1}`} onClick={() => setAssertions(assertions.filter((_, j) => j !== i))}>
                      <IconClose />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section class="bac-rule-section" aria-labelledby="bac-extract-title">
        <header class="bac-rule-head">
          <h3 id="bac-extract-title">Set variables from the response</h3>
          <span class="bac-muted bac-small">
            {envName ? `Saved into “${envName}” after each response, so the next request can use {{name}}.` : 'Activate an environment to save these values.'}
          </span>
          <div class="bac-spacer" />
          <button type="button" class="bac-btn bac-btn-small" onClick={() => setExtractions([...extractions, newExtraction()])}>
            <IconPlus /> Add variable
          </button>
        </header>
        {extractions.length === 0 ? (
          <p class="bac-muted bac-small">Chain requests without scripts: take a token or an id from this response and use it in the next one.</p>
        ) : (
          <div class="bac-rules bac-rules-extract" role="table" aria-label="Variables from the response">
            {extractions.map((x, i) => {
              const invalid = x.variable !== '' && !isValidVariableName(x.variable);
              return (
                <div key={x.id} role="row" class={`bac-rule${x.enabled ? '' : ' is-disabled'}`}>
                  <span role="cell">
                    <input type="checkbox" checked={x.enabled} aria-label={`Use variable rule ${i + 1}`} onChange={(e) => patchExtraction(i, { enabled: e.currentTarget.checked })} />
                  </span>
                  <span role="cell" class="bac-var-name">
                    <span class="bac-muted bac-mono">{'{{'}</span>
                    <input
                      class="bac-input bac-mono"
                      aria-label={`Variable name for rule ${i + 1}`}
                      aria-invalid={invalid || undefined}
                      title={invalid ? 'Names start with a letter or _ and use letters, digits, _ . or -' : undefined}
                      placeholder="accessToken"
                      value={x.variable}
                      spellcheck={false}
                      onInput={(e) => patchExtraction(i, { variable: e.currentTarget.value })}
                    />
                    <span class="bac-muted bac-mono">{'}}'}</span>
                  </span>
                  <span role="cell" class="bac-muted bac-small">
                    from
                  </span>
                  <span role="cell">
                    <select class="bac-select" aria-label={`Source for variable rule ${i + 1}`} value={x.source} onChange={(e) => patchExtraction(i, { source: e.currentTarget.value as Extraction['source'] })}>
                      {Object.entries(EXTRACT_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span role="cell">
                    {needsPath(x.source) ? (
                      <input
                        class="bac-input bac-mono"
                        aria-label={x.source === 'header' ? `Header name for variable rule ${i + 1}` : `JSON path for variable rule ${i + 1}`}
                        placeholder={x.source === 'header' ? 'X-Request-Id' : '$.access_token'}
                        value={x.path}
                        spellcheck={false}
                        onInput={(e) => patchExtraction(i, { path: e.currentTarget.value })}
                      />
                    ) : (
                      <span />
                    )}
                  </span>
                  <span role="cell">
                    <button type="button" class="bac-icon-btn" aria-label={`Remove variable rule ${i + 1}`} onClick={() => setExtractions(extractions.filter((_, j) => j !== i))}>
                      <IconClose />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
