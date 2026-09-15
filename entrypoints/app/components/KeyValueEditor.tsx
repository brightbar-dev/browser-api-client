import type { KeyValuePair } from '@/utils/request';
import { IconClose } from './icons';

interface KeyValueEditorProps {
  label: string;
  rows: KeyValuePair[];
  onChange: (rows: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  keySuggestions?: string[];
}

let listCounter = 0;

/** Rows of enabled/key/value, with a trailing blank row that becomes real as you type. */
export function KeyValueEditor({ label, rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value', keySuggestions }: KeyValueEditorProps) {
  const listId = keySuggestions ? `bac-kv-suggest-${label.replace(/\W+/g, '-').toLowerCase()}-${(listCounter = (listCounter + 1) % 1000)}` : undefined;

  const setRow = (index: number, patch: Partial<KeyValuePair>) => {
    if (index >= rows.length) onChange([...rows, { key: '', value: '', enabled: true, ...patch }]);
    else onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div class="bac-kv" role="table" aria-label={label}>
      <div class="bac-kv-row bac-kv-head" role="row">
        <span role="columnheader">
          <span class="bac-visually-hidden">Enabled</span>
        </span>
        <span role="columnheader">{keyPlaceholder}</span>
        <span role="columnheader">{valuePlaceholder}</span>
        <span role="columnheader">
          <span class="bac-visually-hidden">Remove</span>
        </span>
      </div>
      {[...rows, null].map((row, i) => {
        const name = row?.key || `row ${i + 1}`;
        return (
          <div key={i} role="row" class={`bac-kv-row${row && !row.enabled ? ' is-disabled' : ''}${row ? '' : ' is-new'}`}>
            <span role="cell" class="bac-kv-check">
              {row && (
                <input
                  type="checkbox"
                  checked={row.enabled}
                  aria-label={`Include ${name}`}
                  onChange={(e) => setRow(i, { enabled: e.currentTarget.checked })}
                />
              )}
            </span>
            <span role="cell">
              <input
                class="bac-input bac-mono"
                value={row?.key ?? ''}
                placeholder={row ? '' : `Add ${keyPlaceholder.toLowerCase()}`}
                aria-label={row ? `${keyPlaceholder} of ${name}` : `New ${keyPlaceholder.toLowerCase()}`}
                list={listId}
                spellcheck={false}
                autocomplete="off"
                onInput={(e) => setRow(i, { key: e.currentTarget.value })}
              />
            </span>
            <span role="cell">
              <input
                class="bac-input bac-mono"
                value={row?.value ?? ''}
                placeholder={row ? '' : valuePlaceholder}
                aria-label={row ? `${valuePlaceholder} of ${name}` : `New ${valuePlaceholder.toLowerCase()}`}
                spellcheck={false}
                autocomplete="off"
                onInput={(e) => setRow(i, { value: e.currentTarget.value })}
              />
            </span>
            <span role="cell" class="bac-kv-del">
              {row && (
                <button type="button" class="bac-icon-btn" aria-label={`Remove ${name}`} title="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
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
