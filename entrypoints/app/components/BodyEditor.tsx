import { useMemo } from 'preact/hooks';
import type { ApiRequest, BodyType, FileRef, MultipartField } from '@/utils/request';
import { formatSize, generateId, prettyJson } from '@/utils/request';
import { interpolate } from '@/utils/environment';
import { methodAllowsBody, TEXT_CONTENT_TYPES } from '@/utils/resolve';
import { idbPut } from '@/utils/idb';
import { useApp } from '../store';
import { KeyValueEditor } from './KeyValueEditor';
import { IconClose } from './icons';
import { VarField } from './VarField';

const MODES: Array<{ id: BodyType; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'json', label: 'JSON' },
  { id: 'form', label: 'Form URL-encoded' },
  { id: 'multipart', label: 'Multipart form' },
  { id: 'text', label: 'Raw' },
  { id: 'binary', label: 'File' },
];

interface BodyEditorProps {
  tabId: string;
  request: ApiRequest;
  update: (fn: (r: ApiRequest) => ApiRequest) => void;
}

export function BodyEditor({ tabId, request, update }: BodyEditorProps) {
  const env = useApp((s) => s.environments.find((e) => e.id === s.activeEnvId));
  const mode = request.bodyType;

  return (
    <div class="bac-body-editor">
      <div class="bac-segmented" role="radiogroup" aria-label="Body type">
        {MODES.map((m) => (
          <label key={m.id} class={`bac-seg${mode === m.id ? ' is-on' : ''}`}>
            <input type="radio" name={`bac-body-${tabId}`} checked={mode === m.id} onChange={() => update((r) => ({ ...r, bodyType: m.id }))} />
            {m.label}
          </label>
        ))}
      </div>

      {mode !== 'none' && !methodAllowsBody(request.method) && (
        <p class="bac-notice bac-notice-warn" role="note">
          Browsers never send a body with {request.method}. Change the method to send this body.
        </p>
      )}

      {mode === 'none' && <p class="bac-muted">This request has no body.</p>}

      {mode === 'json' && (
        <JsonBody
          body={request.body}
          variables={env?.variables ?? []}
          onChange={(body) => update((r) => ({ ...r, body }))}
        />
      )}

      {mode === 'text' && (
        <div class="bac-code-editor">
          <div class="bac-editor-toolbar">
            <label class="bac-inline-field">
              <span>Content-Type</span>
              <input
                class="bac-input bac-mono"
                list="bac-text-types"
                value={request.textContentType ?? 'text/plain'}
                spellcheck={false}
                onInput={(e) => update((r) => ({ ...r, textContentType: e.currentTarget.value }))}
              />
              <datalist id="bac-text-types">
                {TEXT_CONTENT_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
          </div>
          <VarField
            multiline
            class="bac-code-input"
            aria-label="Raw body"
            spellcheck={false}
            value={request.body}
            onValue={(body) => update((r) => ({ ...r, body }))}
          />
        </div>
      )}

      {mode === 'form' && (
        <KeyValueEditor
          label="Form fields"
          keyPlaceholder="Field"
          rows={request.formFields ?? []}
          onChange={(formFields) => update((r) => ({ ...r, formFields }))}
        />
      )}

      {mode === 'multipart' && (
        <MultipartEditor
          fields={request.multipartFields ?? []}
          onChange={(multipartFields) => update((r) => ({ ...r, multipartFields }))}
        />
      )}

      {mode === 'binary' && (
        <div class="bac-form">
          <p class="bac-muted">The file’s bytes are sent as the body, with its type as Content-Type unless you set one.</p>
          <FilePicker label="Body file" file={request.binaryFile} onChange={(binaryFile) => update((r) => ({ ...r, binaryFile }))} />
        </div>
      )}
    </div>
  );
}

function JsonBody({ body, variables, onChange }: { body: string; variables: Array<{ key: string; value: string; enabled: boolean }>; onChange: (b: string) => void }) {
  const status = useMemo(() => {
    if (!body.trim()) return null;
    try {
      JSON.parse(interpolate(body, variables));
      return { ok: true as const, message: 'Valid JSON' };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  }, [body, variables]);
  const formattable = useMemo(() => {
    try {
      JSON.parse(body);
      return true;
    } catch {
      return false;
    }
  }, [body]);

  return (
    <div class="bac-code-editor">
      <div class="bac-editor-toolbar">
        <span class={`bac-validity${status ? (status.ok ? ' is-ok' : ' is-bad') : ''}`} role="status" aria-live="polite">
          {status?.message ?? ''}
        </span>
        <div class="bac-spacer" />
        <button
          type="button"
          class="bac-btn bac-btn-small"
          disabled={!formattable}
          title={formattable ? 'Pretty-print the JSON' : 'Only valid JSON can be formatted'}
          onClick={() => onChange(prettyJson(body))}
        >
          Format
        </button>
      </div>
      <VarField
        multiline
        class="bac-code-input"
        aria-label="JSON body"
        spellcheck={false}
        placeholder={'{\n  "name": "Ada Lovelace"\n}'}
        value={body}
        onValue={onChange}
      />
    </div>
  );
}

function MultipartEditor({ fields, onChange }: { fields: MultipartField[]; onChange: (f: MultipartField[]) => void }) {
  const setField = (index: number, patch: Partial<MultipartField>) => {
    if (index >= fields.length) onChange([...fields, { key: '', value: '', enabled: true, kind: 'text', ...patch }]);
    else onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };
  return (
    <div class="bac-kv bac-kv-multipart" role="table" aria-label="Multipart fields">
      <div class="bac-kv-row bac-kv-head" role="row">
        <span role="columnheader">
          <span class="bac-visually-hidden">Enabled</span>
        </span>
        <span role="columnheader">Field</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Value</span>
        <span role="columnheader">
          <span class="bac-visually-hidden">Remove</span>
        </span>
      </div>
      {[...fields, null].map((field, i) => {
        const name = field?.key || `field ${i + 1}`;
        return (
          <div key={i} role="row" class={`bac-kv-row${field && !field.enabled ? ' is-disabled' : ''}${field ? '' : ' is-new'}`}>
            <span role="cell" class="bac-kv-check">
              {field && <input type="checkbox" checked={field.enabled} aria-label={`Include ${name}`} onChange={(e) => setField(i, { enabled: e.currentTarget.checked })} />}
            </span>
            <span role="cell">
              <input
                class="bac-input bac-mono"
                value={field?.key ?? ''}
                placeholder={field ? '' : 'Add field'}
                aria-label={field ? `Name of ${name}` : 'New field name'}
                spellcheck={false}
                autocomplete="off"
                onInput={(e) => setField(i, { key: e.currentTarget.value })}
              />
            </span>
            <span role="cell">
              <select
                class="bac-select"
                aria-label={`Type of ${name}`}
                value={field?.kind ?? 'text'}
                onChange={(e) => setField(i, { kind: e.currentTarget.value === 'file' ? 'file' : 'text' })}
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            </span>
            <span role="cell">
              {field?.kind === 'file' ? (
                <FilePicker label={`File for ${name}`} file={field.file} onChange={(file) => setField(i, { file })} />
              ) : (
                <VarField
                  class="bac-input bac-mono"
                  value={field?.value ?? ''}
                  aria-label={field ? `Value of ${name}` : 'New field value'}
                  spellcheck={false}
                  autocomplete="off"
                  onValue={(value) => setField(i, { value })}
                />
              )}
            </span>
            <span role="cell" class="bac-kv-del">
              {field && (
                <button type="button" class="bac-icon-btn" aria-label={`Remove ${name}`} title="Remove" onClick={() => onChange(fields.filter((_, j) => j !== i))}>
                  <IconClose />
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FilePicker({ label, file, onChange }: { label: string; file?: FileRef; onChange: (f: FileRef | undefined) => void }) {
  const pick = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    const ref: FileRef = { id: generateId(), name: chosen.name, size: chosen.size, type: chosen.type };
    await idbPut('files', ref.id, chosen);
    onChange(ref);
  };
  return (
    <span class="bac-file">
      {file ? (
        <span class="bac-file-name" title={file.name}>
          {file.name} <span class="bac-muted">{formatSize(file.size)}</span>
        </span>
      ) : (
        <span class="bac-muted">No file chosen</span>
      )}
      <label class="bac-btn bac-btn-small">
        {file ? 'Replace…' : 'Choose file…'}
        <input type="file" class="bac-visually-hidden" aria-label={label} onChange={(e) => void pick(e.currentTarget)} />
      </label>
      {file && (
        <button type="button" class="bac-icon-btn" aria-label={`Remove ${file.name}`} title="Remove file" onClick={() => onChange(undefined)}>
          <IconClose />
        </button>
      )}
    </span>
  );
}
