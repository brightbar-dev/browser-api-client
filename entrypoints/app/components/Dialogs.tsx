import { useMemo, useRef, useState } from 'preact/hooks';
import type { ApiRequest } from '@/utils/request';
import type { EnvVariable } from '@/utils/environment';
import { VARIABLE_NAME_RE } from '@/utils/environment';
import { resolveRequest } from '@/utils/resolve';
import { CODEGEN_TARGETS, generateCode, type CodegenTarget } from '@/utils/codegen';
import { detectImportKind, runImport, type ImportKind } from '@/utils/import-detect';
import { closeDialog, getState, openRequest, setActiveEnv, setLayout, showToast, useApp } from '../store';
import { commitCollections, commitEnvironments, createCollection, saveTabToCollection, updateEnvironment } from '../library';
import { Dialog } from './Dialog';
import { RunnerDialog } from './Runner';
import { IconClose, IconCopy, IconEye, IconEyeOff } from './icons';

const NO_VARS: EnvVariable[] = [];

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'save':
      return <SaveDialog tabId={dialog.tabId} />;
    case 'environment':
      return <EnvironmentDialog envId={dialog.envId} />;
    case 'import':
      return <ImportDialog />;
    case 'code':
      return <CodeDialog tabId={dialog.tabId} />;
    case 'runner':
      return <RunnerDialog collectionId={dialog.collectionId} folderId={dialog.folderId} />;
    case 'shortcuts':
      return <ShortcutsDialog />;
  }
}

export function Toast() {
  const toast = useApp((s) => s.toast);
  return (
    <div class="bac-toast-region" role="status" aria-live="polite">
      {toast && (
        <div class="bac-toast" key={toast.id}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

// --- save ---

function suggestName(request: ApiRequest): string {
  if (request.name && request.name !== 'New Request') return request.name;
  const path = request.url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split(/[?#]/)[0] || request.url;
  return `${request.method} ${path || 'request'}`.trim();
}

function SaveDialog({ tabId }: { tabId: string }) {
  const tab = useApp((s) => s.workspace.tabs.find((t) => t.id === tabId));
  const collections = useApp((s) => s.collections);
  const [name, setName] = useState(() => (tab ? suggestName(tab.request) : ''));
  const [collectionId, setCollectionId] = useState(() => tab?.source?.collectionId ?? collections[0]?.id ?? '__new');
  const [newCollectionName, setNewCollectionName] = useState('My API');
  const [folderId, setFolderId] = useState('');
  if (!tab) return null;
  const collection = collections.find((c) => c.id === collectionId);

  const save = (e: Event) => {
    e.preventDefault();
    const target = collectionId === '__new' ? createCollection(newCollectionName.trim() || 'My API') : collection;
    if (!target) return;
    saveTabToCollection(tabId, { collectionId: target.id, folderId: folderId || null, name: name.trim() || 'Untitled request' });
    closeDialog();
    setLayout({ sidebarOpen: true, sidebarPanel: 'collections' });
    showToast(`Saved to “${target.name}”`);
  };

  return (
    <Dialog
      title="Save request"
      onClose={closeDialog}
      footer={
        <>
          <button type="button" class="bac-btn" onClick={closeDialog}>
            Cancel
          </button>
          <button type="submit" form="bac-save-form" class="bac-btn bac-btn-primary">
            Save
          </button>
        </>
      }
    >
      <form id="bac-save-form" class="bac-stack" onSubmit={save}>
        <label class="bac-stack-field">
          <span>Request name</span>
          <input class="bac-input" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class="bac-stack-field">
          <span>Collection</span>
          <select
            class="bac-select"
            value={collectionId}
            onChange={(e) => {
              setCollectionId(e.currentTarget.value);
              setFolderId('');
            }}
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="__new">New collection…</option>
          </select>
        </label>
        {collectionId === '__new' && (
          <label class="bac-stack-field">
            <span>New collection name</span>
            <input class="bac-input" value={newCollectionName} onInput={(e) => setNewCollectionName(e.currentTarget.value)} />
          </label>
        )}
        {collection && (collection.folders?.length ?? 0) > 0 && (
          <label class="bac-stack-field">
            <span>Folder</span>
            <select class="bac-select" value={folderId} onChange={(e) => setFolderId(e.currentTarget.value)}>
              <option value="">No folder</option>
              {collection.folders!.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </form>
    </Dialog>
  );
}

// --- environment editor ---

function EnvironmentDialog({ envId }: { envId: string }) {
  const env = useApp((s) => s.environments.find((e) => e.id === envId));
  const activeEnvId = useApp((s) => s.activeEnvId);
  if (!env) return null;
  const setVariables = (variables: EnvVariable[]) => updateEnvironment(envId, (e) => ({ ...e, variables }), true);

  return (
    <Dialog
      wide
      title="Environment"
      onClose={closeDialog}
      footer={
        <>
          {activeEnvId === envId ? (
            <span class="bac-muted bac-foot-note">Active environment</span>
          ) : (
            <button type="button" class="bac-btn" onClick={() => setActiveEnv(envId)}>
              Use this environment
            </button>
          )}
          <button type="button" class="bac-btn bac-btn-primary" onClick={closeDialog}>
            Done
          </button>
        </>
      }
    >
      <div class="bac-stack">
        <label class="bac-stack-field">
          <span>Name</span>
          <input class="bac-input" value={env.name} onInput={(e) => updateEnvironment(envId, (x) => ({ ...x, name: e.currentTarget.value }), true)} />
        </label>
        <VariablesTable variables={env.variables} onChange={setVariables} />
        <p class="bac-muted bac-small">
          Use a variable as <code>{'{{name}}'}</code> in the URL, params, headers, auth or body. Secret values are masked on screen. Everything stays in this browser.
        </p>
      </div>
    </Dialog>
  );
}

function VariablesTable({ variables, onChange }: { variables: EnvVariable[]; onChange: (v: EnvVariable[]) => void }) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const setRow = (index: number, patch: Partial<EnvVariable>) => {
    if (index >= variables.length) onChange([...variables, { key: '', value: '', enabled: true, ...patch }]);
    else onChange(variables.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  };
  return (
    <div class="bac-kv bac-kv-vars" role="table" aria-label="Variables">
      <div class="bac-kv-row bac-kv-head" role="row">
        <span role="columnheader">
          <span class="bac-visually-hidden">Enabled</span>
        </span>
        <span role="columnheader">Variable</span>
        <span role="columnheader">Value</span>
        <span role="columnheader">Secret</span>
        <span role="columnheader">
          <span class="bac-visually-hidden">Remove</span>
        </span>
      </div>
      {[...variables, null].map((v, i) => {
        const name = v?.key || `variable ${i + 1}`;
        const invalid = !!v?.key && !VARIABLE_NAME_RE.test(v.key);
        const masked = !!v?.secret && !revealed[i];
        return (
          <div key={i} role="row" class={`bac-kv-row${v && !v.enabled ? ' is-disabled' : ''}${v ? '' : ' is-new'}`}>
            <span role="cell" class="bac-kv-check">
              {v && <input type="checkbox" checked={v.enabled} aria-label={`Enable ${name}`} onChange={(e) => setRow(i, { enabled: e.currentTarget.checked })} />}
            </span>
            <span role="cell">
              <input
                class="bac-input bac-mono"
                value={v?.key ?? ''}
                placeholder={v ? '' : 'Add variable'}
                aria-label={v ? `Name of ${name}` : 'New variable name'}
                aria-invalid={invalid || undefined}
                title={invalid ? 'Names start with a letter or _ and use letters, digits, _ . or -' : undefined}
                spellcheck={false}
                autocomplete="off"
                onInput={(e) => setRow(i, { key: e.currentTarget.value })}
              />
            </span>
            <span role="cell" class="bac-var-value">
              <input
                class="bac-input bac-mono"
                type={masked ? 'password' : 'text'}
                value={v?.value ?? ''}
                aria-label={v ? `Value of ${name}` : 'New variable value'}
                spellcheck={false}
                autocomplete="off"
                onInput={(e) => setRow(i, { value: e.currentTarget.value })}
              />
              {v?.secret && (
                <button type="button" class="bac-icon-btn" aria-label={masked ? `Show ${name}` : `Hide ${name}`} aria-pressed={!masked} onClick={() => setRevealed({ ...revealed, [i]: !revealed[i] })}>
                  {masked ? <IconEye /> : <IconEyeOff />}
                </button>
              )}
            </span>
            <span role="cell" class="bac-kv-check">
              {v && <input type="checkbox" checked={!!v.secret} aria-label={`Treat ${name} as secret`} onChange={(e) => setRow(i, { secret: e.currentTarget.checked })} />}
            </span>
            <span role="cell" class="bac-kv-del">
              {v && (
                <button type="button" class="bac-icon-btn" aria-label={`Remove ${name}`} onClick={() => onChange(variables.filter((_, j) => j !== i))}>
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

// --- import ---

const KIND_LABELS: Record<ImportKind, string> = {
  curl: 'cURL command',
  openapi: 'OpenAPI / Swagger specification',
  'postman-collection': 'Postman collection',
  'postman-environment': 'Postman environment',
  har: 'HAR file',
  backup: 'Browser API Client backup',
  unknown: 'Not recognised yet',
};

function ImportDialog() {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ summary: string; warnings: string[] } | null>(null);
  const kind = useMemo(() => (text.trim() ? detectImportKind(text) : null), [text]);
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = () => {
    try {
      const out = runImport(text);
      const s = getState();
      if (out.collections.length) commitCollections([...s.collections, ...out.collections]);
      if (out.environments.length) commitEnvironments([...s.environments, ...out.environments]);
      for (const request of out.requests) openRequest(request);
      if (out.collections.length) setLayout({ sidebarOpen: true, sidebarPanel: 'collections' });
      else if (out.environments.length) setLayout({ sidebarOpen: true, sidebarPanel: 'environments' });
      setError('');
      if (out.warnings.length) setResult({ summary: out.summary, warnings: out.warnings });
      else {
        closeDialog();
        showToast(out.summary);
      }
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    }
  };

  return (
    <Dialog
      wide
      title="Import"
      onClose={closeDialog}
      footer={
        result ? (
          <button type="button" class="bac-btn bac-btn-primary" onClick={closeDialog}>
            Done
          </button>
        ) : (
          <>
            <button type="button" class="bac-btn" onClick={closeDialog}>
              Cancel
            </button>
            <button type="button" class="bac-btn bac-btn-primary" disabled={!kind || kind === 'unknown' || kind === 'backup'} onClick={doImport}>
              Import
            </button>
          </>
        )
      }
    >
      {result ? (
        <div class="bac-stack">
          <p>{result.summary}</p>
          <div class="bac-notice bac-notice-warn">
            <p class="bac-notice-title">Check these before you send:</p>
            <ul>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div class="bac-stack">
          <p class="bac-muted bac-small">Paste a cURL command, an OpenAPI 3 or Swagger 2 JSON spec, a Postman v2.1 collection or environment, or a HAR file — or choose a file.</p>
          <textarea
            class="bac-code-input bac-import-text"
            aria-label="Text to import"
            spellcheck={false}
            placeholder={"curl -X POST 'https://api.example.com/users' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"Ada\"}'"}
            value={text}
            onInput={(e) => {
              setText(e.currentTarget.value);
              setError('');
            }}
          />
          <div class="bac-row">
            <button type="button" class="bac-btn bac-btn-small" onClick={() => fileRef.current?.click()}>
              Choose file…
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".json,.har,.txt,.sh,application/json"
              onChange={async (e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                input.value = '';
                if (file) setText(await file.text());
              }}
            />
            {kind && (
              <span class={`bac-detected${kind === 'unknown' || kind === 'backup' ? ' is-bad' : ''}`}>
                {kind === 'backup' ? 'Browser API Client backup — import it from Settings' : `Detected: ${KIND_LABELS[kind]}`}
              </span>
            )}
          </div>
          {error && (
            <p class="bac-notice bac-notice-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

// --- code snippets ---

let lastTarget: CodegenTarget = 'curl';

function CodeDialog({ tabId }: { tabId: string }) {
  const request = useApp((s) => s.workspace.tabs.find((t) => t.id === tabId)?.request);
  const variables = useApp((s) => s.environments.find((e) => e.id === s.activeEnvId)?.variables ?? NO_VARS);
  const [target, setTargetState] = useState<CodegenTarget>(lastTarget);
  const setTarget = (t: CodegenTarget) => {
    lastTarget = t;
    setTargetState(t);
  };
  const code = useMemo(() => (request ? generateCode(target, resolveRequest(request, variables).request) : ''), [request, variables, target]);
  if (!request) return null;
  const hasSecrets = variables.some((v) => v.secret && v.enabled);

  return (
    <Dialog wide title="Code snippet" onClose={closeDialog}>
      <div class="bac-codegen">
        <div role="tablist" aria-label="Language" aria-orientation="vertical" class="bac-codegen-targets">
          {CODEGEN_TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === target}
              class={`bac-codegen-target${t.id === target ? ' is-active' : ''}`}
              onClick={() => setTarget(t.id)}
              onKeyDown={(e) => {
                const idx = CODEGEN_TARGETS.findIndex((x) => x.id === target);
                const next = e.key === 'ArrowDown' ? idx + 1 : e.key === 'ArrowUp' ? idx - 1 : null;
                if (next === null) return;
                e.preventDefault();
                const t2 = CODEGEN_TARGETS[(next + CODEGEN_TARGETS.length) % CODEGEN_TARGETS.length]!;
                setTarget(t2.id);
                (e.currentTarget.parentElement?.children[(next + CODEGEN_TARGETS.length) % CODEGEN_TARGETS.length] as HTMLElement | undefined)?.focus();
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div class="bac-codegen-output" role="tabpanel">
          <div class="bac-editor-toolbar">
            <span class="bac-muted bac-small">
              {hasSecrets ? 'Variables are filled in from the active environment, including secret values.' : 'Variables are filled in from the active environment.'}
            </span>
            <div class="bac-spacer" />
            <button
              type="button"
              class="bac-btn bac-btn-small"
              onClick={() => {
                void navigator.clipboard.writeText(code);
                showToast('Copied');
              }}
            >
              <IconCopy /> Copy
            </button>
          </div>
          <pre class="bac-code bac-codegen-code" tabIndex={0}>
            {code}
          </pre>
        </div>
      </div>
    </Dialog>
  );
}

// --- keyboard shortcuts ---

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? '⌘' : 'Ctrl';
const ALT = mac ? '⌥' : 'Alt';

const SHORTCUTS: Array<[string, string[]]> = [
  ['Send the request', [`${MOD} Enter`]],
  ['Save to a collection', [`${MOD} S`]],
  ['New request tab', [`${ALT} T`]],
  ['Close the tab', [`${ALT} W`]],
  ['Focus the URL', [`${ALT} L`]],
  ['Cancel a request or stop a stream', ['Esc']],
  ['Next / previous tab (on the tab strip)', ['→', '←']],
  ['Next / previous search match', ['Enter', 'Shift Enter']],
  ['Rename in the collection tree', ['F2']],
  ['Move a request, folder or collection', [`${ALT} ↑`, `${ALT} ↓`]],
  ['Show this list', ['?']],
];

function ShortcutsDialog() {
  return (
    <Dialog title="Keyboard shortcuts" onClose={closeDialog}>
      <table class="bac-shortcuts">
        <tbody>
          {SHORTCUTS.map(([label, keys]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                {keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && ' / '}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="bac-muted bac-small">
        Browsers reserve {MOD} T, {MOD} W and {MOD} L for their own tabs and address bar, so the app uses {ALT} instead.
      </p>
    </Dialog>
  );
}
