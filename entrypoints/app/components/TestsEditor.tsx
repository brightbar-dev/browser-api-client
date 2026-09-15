import type { ApiRequest } from '@/utils/request';
import type { Assertion, AssertionOp, AssertionSource, Extraction } from '@/utils/assertions';
import { isValidVariableName, newAssertion, newExtraction, opsForSource } from '@/utils/assertions';
import { useApp } from '../store';
import { IconClose, IconPlus } from './icons';
import { t } from '@/utils/i18n';

const SOURCE_LABELS: Record<AssertionSource, string> = {
  status: t('testsSourceStatus'),
  header: t('testsSourceHeader'),
  jsonpath: t('testsSourceJsonPath'),
  body: t('testsSourceBody'),
  time: t('testsSourceTime'),
};

const OP_LABELS: Record<AssertionOp, string> = {
  equals: t('testsOpEquals'),
  'not-equals': t('testsOpNotEquals'),
  exists: t('testsOpExists'),
  'not-exists': t('testsOpNotExists'),
  contains: t('testsOpContains'),
  'not-contains': t('testsOpNotContains'),
  lt: t('testsOpLt'),
  lte: t('testsOpLte'),
  gt: t('testsOpGt'),
  gte: t('testsOpGte'),
  matches: t('testsOpMatches'),
  'type-is': t('testsOpTypeIs'),
};

const EXTRACT_LABELS: Record<Extraction['source'], string> = {
  jsonpath: t('testsSourceJsonPath'),
  header: t('testsSourceHeader'),
  status: t('testsSourceStatus'),
  body: t('testsSourceWholeBody'),
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
          <h3 id="bac-tests-title">{t('testsTitle')}</h3>
          <span class="bac-muted bac-small">{t('testsHint')}</span>
          <div class="bac-spacer" />
          <button type="button" class="bac-btn bac-btn-small" onClick={() => setAssertions([...assertions, newAssertion(assertions.length ? 'jsonpath' : 'status')])}>
            <IconPlus /> {t('testsAdd')}
          </button>
        </header>
        {assertions.length === 0 ? (
          <p class="bac-muted bac-small">
            {t('testsEmpty')}{' '}
            <button type="button" class="bac-link-btn" onClick={() => setAssertions([{ ...newAssertion('status'), op: 'equals', expected: '200' }])}>
              {t('testsAddStatus200')}
            </button>
          </p>
        ) : (
          <div class="bac-rules bac-rules-tests" role="table" aria-label={t('testsTitle')}>
            {assertions.map((a, i) => {
              const ops = opsForSource(a.source);
              return (
                <div key={a.id} role="row" class={`bac-rule${a.enabled ? '' : ' is-disabled'}`}>
                  <span role="cell">
                    <input type="checkbox" checked={a.enabled} aria-label={t('testsRunN', i + 1)} onChange={(e) => patchAssertion(i, { enabled: e.currentTarget.checked })} />
                  </span>
                  <span role="cell">
                    <select
                      class="bac-select"
                      aria-label={t('testsSourceN', i + 1)}
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
                        aria-label={a.source === 'header' ? t('testsHeaderNameN', i + 1) : t('testsJsonPathN', i + 1)}
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
                    <select class="bac-select" aria-label={t('testsConditionN', i + 1)} value={a.op} onChange={(e) => patchAssertion(i, { op: e.currentTarget.value as AssertionOp })}>
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
                        aria-label={t('testsExpectedN', i + 1)}
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
                    <button type="button" class="bac-icon-btn" aria-label={t('testsRemoveN', i + 1)} onClick={() => setAssertions(assertions.filter((_, j) => j !== i))}>
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
          <h3 id="bac-extract-title">{t('extractTitle')}</h3>
          <span class="bac-muted bac-small">
            {envName ? t('extractHintEnv', envName, '{{name}}') : t('extractHintNoEnv')}
          </span>
          <div class="bac-spacer" />
          <button type="button" class="bac-btn bac-btn-small" onClick={() => setExtractions([...extractions, newExtraction()])}>
            <IconPlus /> {t('extractAdd')}
          </button>
        </header>
        {extractions.length === 0 ? (
          <p class="bac-muted bac-small">{t('extractEmpty')}</p>
        ) : (
          <div class="bac-rules bac-rules-extract" role="table" aria-label={t('extractTableLabel')}>
            {extractions.map((x, i) => {
              const invalid = x.variable !== '' && !isValidVariableName(x.variable);
              return (
                <div key={x.id} role="row" class={`bac-rule${x.enabled ? '' : ' is-disabled'}`}>
                  <span role="cell">
                    <input type="checkbox" checked={x.enabled} aria-label={t('extractUseN', i + 1)} onChange={(e) => patchExtraction(i, { enabled: e.currentTarget.checked })} />
                  </span>
                  <span role="cell" class="bac-var-name">
                    <span class="bac-muted bac-mono">{'{{'}</span>
                    <input
                      class="bac-input bac-mono"
                      aria-label={t('extractVariableNameN', i + 1)}
                      aria-invalid={invalid || undefined}
                      title={invalid ? t('varNameRule') : undefined}
                      placeholder="accessToken"
                      value={x.variable}
                      spellcheck={false}
                      onInput={(e) => patchExtraction(i, { variable: e.currentTarget.value })}
                    />
                    <span class="bac-muted bac-mono">{'}}'}</span>
                  </span>
                  <span role="cell" class="bac-muted bac-small">
                    {t('extractFrom')}
                  </span>
                  <span role="cell">
                    <select class="bac-select" aria-label={t('extractSourceN', i + 1)} value={x.source} onChange={(e) => patchExtraction(i, { source: e.currentTarget.value as Extraction['source'] })}>
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
                        aria-label={x.source === 'header' ? t('extractHeaderNameN', i + 1) : t('extractJsonPathN', i + 1)}
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
                    <button type="button" class="bac-icon-btn" aria-label={t('extractRemoveN', i + 1)} onClick={() => setExtractions(extractions.filter((_, j) => j !== i))}>
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
