import { useMemo, useState } from 'preact/hooks';
import type { ApiRequest, AuthConfig, HttpMethod } from '@/utils/request';
import { HTTP_METHODS } from '@/utils/request';
import { impliedScheme, paramsFromUrl, urlWithParams } from '@/utils/url';
import { resolveRequest } from '@/utils/resolve';
import { parseCurl } from '@/utils/curl-import';
import * as col from '@/utils/collections';
import { openDialog, showToast, updateRequest, useApp } from '../store';
import { requestSave } from '../library';
import { VarField } from './VarField';
import { cancelSend, sendTab } from '../send';
import { COMMON_HEADERS, KeyValueEditor } from './KeyValueEditor';
import { BodyEditor } from './BodyEditor';
import { IconEye, IconEyeOff } from './icons';

type Section = 'params' | 'headers' | 'auth' | 'body';
const sectionMemory = new Map<string, Section>();

const AUTH_LABELS: Record<AuthConfig['type'], string> = {
  none: 'No auth',
  bearer: 'Bearer token',
  basic: 'Basic auth',
  'api-key': 'API key',
};

const BODY_LABELS: Record<ApiRequest['bodyType'], string> = {
  none: 'None',
  json: 'JSON',
  form: 'URL-encoded',
  multipart: 'Multipart',
  text: 'Raw',
  binary: 'File',
  graphql: 'GraphQL',
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const SEND_SHORTCUT = isMac ? '⌘↵' : 'Ctrl+Enter';
export const SAVE_SHORTCUT = isMac ? '⌘S' : 'Ctrl+S';

export function RequestEditor({ tabId }: { tabId: string }) {
  const request = useApp((s) => s.workspace.tabs.find((t) => t.id === tabId)?.request);
  const source = useApp((s) => s.workspace.tabs.find((t) => t.id === tabId)?.source);
  const sending = useApp((s) => s.runs[tabId]?.state === 'sending');
  const env = useApp((s) => s.environments.find((e) => e.id === s.activeEnvId));
  const collections = useApp((s) => s.collections);
  const unresolved = useMemo(() => (request ? resolveRequest(request, env?.variables ?? []).unresolved : []), [request, env]);
  const [section, setSectionState] = useState<Section>(
    () => sectionMemory.get(tabId) ?? (request && request.bodyType !== 'none' ? 'body' : 'params'),
  );
  if (!request) return null;

  const setSection = (next: Section) => {
    sectionMemory.set(tabId, next);
    setSectionState(next);
  };
  const update = (fn: (r: ApiRequest) => ApiRequest) => updateRequest(tabId, fn);
  const scheme = impliedScheme(request.url);
  const paramCount = request.params.filter((p) => p.enabled && (p.key || p.value)).length;
  const headerCount = request.headers.filter((h) => h.enabled && h.key).length;

  const sections: Array<{ id: Section; label: string; badge?: string }> = [
    { id: 'params', label: 'Params', badge: paramCount ? String(paramCount) : undefined },
    { id: 'headers', label: 'Headers', badge: headerCount ? String(headerCount) : undefined },
    { id: 'auth', label: 'Auth', badge: request.auth.type !== 'none' ? AUTH_LABELS[request.auth.type] : undefined },
    { id: 'body', label: 'Body', badge: request.bodyType !== 'none' ? BODY_LABELS[request.bodyType] : undefined },
  ];

  const home = source ? collections.find((c) => c.id === source.collectionId) : undefined;
  const homeFolder = home && source ? col.findRequestLocation([home], source.requestId)?.folderId : null;
  const folderName = home && homeFolder ? home.folders?.find((f) => f.id === homeFolder)?.name : undefined;

  const onUrlPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/^\s*(\$\s*)?curl\s/i.test(text)) return;
    e.preventDefault();
    try {
      const { value, warnings } = parseCurl(text);
      update((r) => ({ ...value, id: r.id, name: r.name && r.name !== 'New Request' ? r.name : value.name }));
      showToast(warnings.length ? `Imported the cURL command. ${warnings[0]}` : 'Imported the cURL command');
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  return (
    <section class="bac-request" aria-label="Request">
      <div class="bac-reqhead">
        {home && (
          <span class="bac-breadcrumb" title="Saved in">
            {home.name}
            {folderName ? ` / ${folderName}` : ''} /
          </span>
        )}
        <input
          class="bac-name-input"
          aria-label="Request name"
          placeholder="Untitled request"
          value={request.name === 'New Request' ? '' : request.name}
          onInput={(e) => {
            const name = e.currentTarget.value;
            update((r) => ({ ...r, name: name || 'New Request' }));
          }}
        />
        <div class="bac-spacer" />
        <button type="button" class="bac-btn bac-btn-small bac-btn-ghost" onClick={() => openDialog({ type: 'code', tabId })} title="Generate code for this request">
          {'</>'} Code
        </button>
        <button type="button" class="bac-btn bac-btn-small" onClick={() => requestSave(tabId)} title={`Save (${SAVE_SHORTCUT})`}>
          {source && home ? 'Save' : 'Save…'}
        </button>
      </div>
      <form
        class="bac-urlbar"
        onSubmit={(e) => {
          e.preventDefault();
          void sendTab(tabId);
        }}
      >
        <select
          class={`bac-method-select m-${request.method.toLowerCase()}`}
          aria-label="HTTP method"
          value={request.method}
          onChange={(e) => update((r) => ({ ...r, method: e.currentTarget.value as HttpMethod }))}
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <VarField
          class="bac-url-input bac-mono"
          aria-label="Request URL"
          placeholder="https://api.example.com/users?page=1 — or paste a cURL command"
          spellcheck={false}
          autocomplete="off"
          value={request.url}
          onPaste={onUrlPaste}
          onValue={(url) => update((r) => ({ ...r, url, params: paramsFromUrl(url, r.params) }))}
        />
        {sending ? (
          <button key="cancel" type="button" class="bac-btn bac-btn-danger bac-send" onClick={() => cancelSend(tabId)} title="Cancel (Esc)">
            Cancel
          </button>
        ) : (
          <button key="send" type="submit" class="bac-btn bac-btn-primary bac-send" title={`Send (${SEND_SHORTCUT})`}>
            Send
          </button>
        )}
      </form>
      {scheme && (
        <p class="bac-url-hint" role="note">
          No scheme typed — this request will be sent over <strong>{scheme}://</strong>
        </p>
      )}
      {unresolved.length > 0 && (
        <p class="bac-url-hint is-warn" role="note">
          {env ? `Not defined in “${env.name}”: ` : 'No environment is active, so these stay as typed: '}
          {unresolved.map((name, i) => (
            <span key={name}>
              {i > 0 && ', '}
              <code>{`{{${name}}}`}</code>
            </span>
          ))}
        </p>
      )}

      <div role="tablist" aria-label="Request parts" class="bac-subtabs">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`bac-req-tab-${s.id}`}
            aria-selected={section === s.id}
            aria-controls="bac-req-panel"
            class={`bac-subtab${section === s.id ? ' is-active' : ''}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
            {s.badge && <span class="bac-subtab-badge">{s.badge}</span>}
          </button>
        ))}
      </div>

      <div class="bac-request-panel" role="tabpanel" id="bac-req-panel" aria-labelledby={`bac-req-tab-${section}`}>
        {section === 'params' && (
          <KeyValueEditor
            label="Query parameters"
            rows={request.params}
            keyPlaceholder="Parameter"
            onChange={(params) => update((r) => ({ ...r, params, url: urlWithParams(r.url, params) }))}
          />
        )}
        {section === 'headers' && (
          <KeyValueEditor
            label="Request headers"
            rows={request.headers}
            keyPlaceholder="Header"
            keySuggestions={COMMON_HEADERS}
            onChange={(headers) => update((r) => ({ ...r, headers }))}
          />
        )}
        {section === 'auth' && <AuthEditor auth={request.auth} onChange={(auth) => update((r) => ({ ...r, auth }))} />}
        {section === 'body' && <BodyEditor tabId={tabId} request={request} update={update} />}
      </div>
    </section>
  );
}

function SecretInput({ value, onInput, label, placeholder }: { value: string; onInput: (v: string) => void; label: string; placeholder?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span class="bac-secret">
      <input
        class="bac-input bac-mono"
        type={shown ? 'text' : 'password'}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        spellcheck={false}
        autocomplete="off"
        onInput={(e) => onInput(e.currentTarget.value)}
      />
      <button type="button" class="bac-icon-btn" aria-label={shown ? `Hide ${label}` : `Show ${label}`} aria-pressed={shown} onClick={() => setShown(!shown)}>
        {shown ? <IconEyeOff /> : <IconEye />}
      </button>
    </span>
  );
}

function AuthEditor({ auth, onChange }: { auth: AuthConfig; onChange: (a: AuthConfig) => void }) {
  const set = (patch: Partial<AuthConfig>) => onChange({ ...auth, ...patch });
  return (
    <div class="bac-form">
      <label class="bac-field">
        <span class="bac-field-label">Type</span>
        <select class="bac-select" value={auth.type} onChange={(e) => set({ type: e.currentTarget.value as AuthConfig['type'] })}>
          {Object.entries(AUTH_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {auth.type === 'none' && <p class="bac-muted">This request sends no credentials. Pick a type to add them; {'{{variables}}'} work in every field.</p>}

      {auth.type === 'bearer' && (
        <label class="bac-field">
          <span class="bac-field-label">Token</span>
          <SecretInput label="Token" value={auth.token || ''} placeholder="{{accessToken}}" onInput={(token) => set({ token })} />
        </label>
      )}

      {auth.type === 'basic' && (
        <>
          <label class="bac-field">
            <span class="bac-field-label">Username</span>
            <input class="bac-input bac-mono" value={auth.username || ''} spellcheck={false} autocomplete="off" onInput={(e) => set({ username: e.currentTarget.value })} />
          </label>
          <label class="bac-field">
            <span class="bac-field-label">Password</span>
            <SecretInput label="Password" value={auth.password || ''} onInput={(password) => set({ password })} />
          </label>
        </>
      )}

      {auth.type === 'api-key' && (
        <>
          <label class="bac-field">
            <span class="bac-field-label">Key</span>
            <input class="bac-input bac-mono" value={auth.headerName || ''} placeholder="X-API-Key" spellcheck={false} autocomplete="off" onInput={(e) => set({ headerName: e.currentTarget.value })} />
          </label>
          <label class="bac-field">
            <span class="bac-field-label">Value</span>
            <SecretInput label="API key value" value={auth.headerValue || ''} onInput={(headerValue) => set({ headerValue })} />
          </label>
          <fieldset class="bac-field bac-fieldset">
            <legend class="bac-field-label">Send in</legend>
            <div class="bac-segmented">
              {(['header', 'query'] as const).map((where) => (
                <label key={where} class={`bac-seg${(auth.apiKeyIn ?? 'header') === where ? ' is-on' : ''}`}>
                  <input type="radio" name="bac-apikey-in" checked={(auth.apiKeyIn ?? 'header') === where} onChange={() => set({ apiKeyIn: where })} />
                  {where === 'header' ? 'Header' : 'Query string'}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      {auth.type !== 'none' && <p class="bac-muted">Credentials are stored only in this browser.</p>}
    </div>
  );
}
