import type { KeyValuePair } from '@/utils/request';
import { t } from '@/utils/i18n';
import { IconClose } from './icons';
import { VarField } from './VarField';

/** What the key column holds; each has its own wording so translations need not derive it. */
export type KeyKind = 'parameter' | 'header' | 'field';

interface KeyValueEditorProps {
  label: string;
  rows: KeyValuePair[];
  onChange: (rows: KeyValuePair[]) => void;
  keyKind: KeyKind;
  keySuggestions?: string[];
}

function keyTexts(kind: KeyKind) {
  switch (kind) {
    case 'parameter':
      return { column: t('kvParameter'), add: t('kvAddParameter'), fresh: t('kvNewParameter'), of: (name: string) => t('kvParameterOf', name) };
    case 'header':
      return { column: t('kvHeader'), add: t('kvAddHeader'), fresh: t('kvNewHeader'), of: (name: string) => t('kvHeaderOf', name) };
    case 'field':
      return { column: t('kvField'), add: t('kvAddField'), fresh: t('kvNewField'), of: (name: string) => t('kvFieldOf', name) };
  }
}

let listCounter = 0;

/** Rows of enabled/key/value, with a trailing blank row that becomes real as you type. */
export function KeyValueEditor({ label, rows, onChange, keyKind, keySuggestions }: KeyValueEditorProps) {
  const listId = keySuggestions ? `bac-kv-suggest-${label.replace(/\W+/g, '-').toLowerCase()}-${(listCounter = (listCounter + 1) % 1000)}` : undefined;
  const keyText = keyTexts(keyKind);

  const setRow = (index: number, patch: Partial<KeyValuePair>) => {
    if (index >= rows.length) onChange([...rows, { key: '', value: '', enabled: true, ...patch }]);
    else onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div class="bac-kv" role="table" aria-label={label}>
      <div class="bac-kv-row bac-kv-head" role="row">
        <span role="columnheader">
          <span class="bac-visually-hidden">{t('commonEnabled')}</span>
        </span>
        <span role="columnheader">{keyText.column}</span>
        <span role="columnheader">{t('commonValue')}</span>
        <span role="columnheader">
          <span class="bac-visually-hidden">{t('commonRemove')}</span>
        </span>
      </div>
      {[...rows, null].map((row, i) => {
        const name = row?.key || t('kvRowN', i + 1);
        return (
          <div key={i} role="row" class={`bac-kv-row${row && !row.enabled ? ' is-disabled' : ''}${row ? '' : ' is-new'}`}>
            <span role="cell" class="bac-kv-check">
              {row && (
                <input
                  type="checkbox"
                  checked={row.enabled}
                  aria-label={t('kvIncludeNamed', name)}
                  onChange={(e) => setRow(i, { enabled: e.currentTarget.checked })}
                />
              )}
            </span>
            <span role="cell">
              <VarField
                class="bac-input bac-mono"
                value={row?.key ?? ''}
                placeholder={row ? '' : keyText.add}
                aria-label={row ? keyText.of(name) : keyText.fresh}
                list={listId}
                spellcheck={false}
                autocomplete="off"
                onValue={(key) => setRow(i, { key })}
              />
            </span>
            <span role="cell">
              <VarField
                class="bac-input bac-mono"
                value={row?.value ?? ''}
                placeholder={row ? '' : t('commonValue')}
                aria-label={row ? t('kvValueOf', name) : t('kvNewValue')}
                spellcheck={false}
                autocomplete="off"
                onValue={(value) => setRow(i, { value })}
              />
            </span>
            <span role="cell" class="bac-kv-del">
              {row && (
                <button type="button" class="bac-icon-btn" aria-label={t('commonRemoveNamed', name)} title={t('commonRemove')} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  <IconClose />
                </button>
              )}
            </span>
          </div>
        );
      })}
      {keySuggestions && (
        <datalist id={listId}>
          {keySuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}

export const COMMON_HEADERS = [
  'Accept', 'Accept-Language', 'Authorization', 'Cache-Control', 'Content-Type', 'If-Match', 'If-None-Match',
  'If-Modified-Since', 'Idempotency-Key', 'Prefer', 'Range', 'User-Agent', 'X-API-Key', 'X-Request-ID', 'X-Correlation-ID',
];
