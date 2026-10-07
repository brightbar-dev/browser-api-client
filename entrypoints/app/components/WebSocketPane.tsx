import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ApiRequest } from '@/utils/request';
import { toHttpRequest, parseProtocols, checkJson, defaultMessageName, filterLog, formatLogTime, impliedWsScheme, logToText, newSavedMessage, wsConfig, MAX_SAVED_MESSAGES, type WsConfig, type WsDirection, type WsLogEntry, type WsMessageFormat } from '@/utils/websocket';
import { formatSize } from '@/utils/request';
import { safeFileName, downloadText } from '../download';
import { requestSave } from '../library';
import { showToast, updateRequest, useApp } from '../store';
import { clearWsLog, connectWs, disconnectWs, primaryWsAction, sendWs } from '../websocket';
import type { WsSession } from '../types';
import { VarField } from './VarField';
import { IconCopy, IconDownload } from './icons';
import { SEND_SHORTCUT } from './RequestEditor';
import { t, tParts } from '@/utils/i18n';

type Section = 'message' | 'saved' | 'connection';
const sectionMemory = new Map<string, Section>();

const STATE_LABEL: Record<WsSession['state'] | 'idle', () => string> = {
  idle: () => t('wsStateIdle'),
  connecting: () => t('wsStateConnecting'),
  open: () => t('wsStateOpen'),
  closing: () => t('wsStateClosing'),
  closed: () => t('wsStateClosed'),
};

const useWs = (tabId: string) => useApp((s) => s.wsSessions[tabId]);

function ConnectionState({ session }: { session: WsSession | undefined }) {
  const state = session?.state ?? 'idle';
  return (
    <span class={`bac-ws-state is-${state}`} role="status">
      <span class="bac-ws-dot" aria-hidden="true" />
      {STATE_LABEL[state]()}
      {state === 'open' && session?.protocol ? <span class="bac-muted"> · {session.protocol}</span> : null}
    </span>
  );
}

export function WebSocketEditor({ tabId }: { tabId: string }) {
  const request = useApp((s) => s.workspace.tabs.find((x) => x.id === tabId)?.request);
  const source = useApp((s) => s.workspace.tabs.find((x) => x.id === tabId)?.source);
  const collections = useApp((s) => s.collections);
  const session = useWs(tabId);
  const [section, setSectionState] = useState<Section>(() => sectionMemory.get(tabId) ?? 'message');
  if (!request) return null;
  const setSection = (next: Section) => {
    sectionMemory.set(tabId, next);
    setSectionState(next);
  };
  const update = (fn: (r: ApiRequest) => ApiRequest) => updateRequest(tabId, fn);
  const setWs = (patch: Partial<WsConfig>) => update((r) => ({ ...r, ws: { ...wsConfig(r), ...patch } }));
  const cfg = wsConfig(request);
  const state = session?.state ?? 'idle';
  const busy = state === 'connecting' || state === 'open' || state === 'closing';
  const home = source ? collections.find((c) => c.id === source.collectionId) : undefined;
  const scheme = impliedWsScheme(request.url);

  const sections: Array<{ id: Section; label: string; badge?: string }> = [
    { id: 'message', label: t('wsTabMessage') },
    { id: 'saved', label: t('wsTabSaved'), badge: cfg.saved.length ? String(cfg.saved.length) : undefined },
    { id: 'connection', label: t('wsTabConnection'), badge: cfg.protocols.trim() ? String(parseProtocols(cfg.protocols).protocols.length) : undefined },
  ];

  return (
    <section class="bac-request" aria-label={t('wsSectionLabel')}>
      <div class="bac-reqhead">
        {home && <span class="bac-breadcrumb" title={t('requestSavedIn')}>{home.name} /</span>}
        <input
          class="bac-name-input"
          aria-label={t('requestNameLabel')}
          placeholder={t('requestUntitled')}
          value={request.name === 'New Request' ? '' : request.name}
          onInput={(e) => {
            const name = e.currentTarget.value;
            update((r) => ({ ...r, name: name || 'New Request' }));
          }}
        />
        <div class="bac-spacer" />
        <button type="button" class="bac-btn bac-btn-small" onClick={() => requestSave(tabId)}>
          {source && home ? t('commonSave') : t('requestSaveEllipsis')}
        </button>
      </div>
      <form
        class="bac-urlbar"
        onSubmit={(e) => {
          e.preventDefault();
          primaryWsAction(tabId);
        }}
      >
        <select
          class="bac-method-select m-ws"
          aria-label={t('wsTypeLabel')}
          value="websocket"
          disabled={busy}
          title={busy ? t('wsTypeLockedTitle') : undefined}
          onChange={(e) => {
            if (e.currentTarget.value === 'http') update(toHttpRequest);
          }}
        >
          <option value="websocket">WebSocket</option>
          <option value="http">{t('wsTypeHttp')}</option>
        </select>
        <VarField
          class="bac-url-input bac-mono"
          aria-label={t('wsUrlLabel')}
          placeholder="wss://echo.example.com/socket"
          spellcheck={false}
          autocomplete="off"
          value={request.url}
          onValue={(url) => update((r) => ({ ...r, url }))}
        />
        {busy ? (
          <button type="button" class="bac-btn bac-btn-danger bac-send" disabled={state === 'closing'} onClick={() => disconnectWs(tabId)}>
            {state === 'connecting' ? t('commonCancel') : t('wsDisconnect')}
          </button>
        ) : (
          <button type="submit" class="bac-btn bac-btn-primary bac-send" title={t('wsConnectTitle', SEND_SHORTCUT)}>
            {t('wsConnect')}
          </button>
        )}
        <ConnectionState session={session} />
      </form>
      {scheme && (
        <p class="bac-url-hint" role="note">
          {tParts('requestNoScheme', <strong>{scheme}://</strong>)}
        </p>
      )}
      {session?.error && !busy && (
        <p class="bac-url-hint is-warn" role="alert">
          {session.error}
        </p>
      )}

      <div role="tablist" aria-label={t('wsPartsLabel')} class="bac-subtabs">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`bac-ws-tab-${s.id}`}
            aria-selected={section === s.id}
            aria-controls="bac-ws-panel"
            class={`bac-subtab${section === s.id ? ' is-active' : ''}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
            {s.badge && <span class="bac-subtab-badge">{s.badge}</span>}
          </button>
        ))}
      </div>

      <div class="bac-request-panel" role="tabpanel" id="bac-ws-panel" aria-labelledby={`bac-ws-tab-${section}`}>
        {section === 'message' && <Composer tabId={tabId} cfg={cfg} setWs={setWs} state={state} />}
        {section === 'saved' && <SavedMessages tabId={tabId} cfg={cfg} setWs={setWs} state={state} onLoaded={() => setSection('message')} />}
        {section === 'connection' && <ConnectionSettings cfg={cfg} setWs={setWs} />}
      </div>
    </section>
  );
}

function Composer({ tabId, cfg, setWs, state }: { tabId: string; cfg: WsConfig; setWs: (p: Partial<WsConfig>) => void; state: WsSession['state'] | 'idle' }) {
  const json = cfg.draftFormat === 'json' ? checkJson(cfg.draft) : null;
  const open = state === 'open';
  const send = () => {
    const out = sendWs(tabId, cfg.draft, cfg.draftFormat);
    if (!out.ok) showToast(out.error);
  };
  const saveMessage = () => {
    if (!cfg.draft.trim()) return;
    if (cfg.saved.length >= MAX_SAVED_MESSAGES) {
      showToast(t('wsSavedLimit', MAX_SAVED_MESSAGES));
      return;
    }
    const name = defaultMessageName(cfg.draft);
    setWs({ saved: [...cfg.saved, newSavedMessage(name, cfg.draftFormat, cfg.draft)] });
    showToast(t('wsMessageSaved', name));
  };
  return (
    <div class="bac-ws-composer">
      <div class="bac-ws-composer-bar">
        <fieldset class="bac-fieldset bac-ws-format">
          <legend class="bac-visually-hidden">{t('wsFormatLabel')}</legend>
          <div class="bac-segmented bac-segmented-small">
            {(['text', 'json'] as const).map((f) => (
              <label key={f} class={`bac-seg${cfg.draftFormat === f ? ' is-on' : ''}`}>
                <input type="radio" name="bac-ws-format" checked={cfg.draftFormat === f} onChange={() => setWs({ draftFormat: f })} />
                {f === 'text' ? t('wsFormatText') : 'JSON'}
              </label>
            ))}
          </div>
        </fieldset>
        {json && (
          <button
            type="button"
            class="bac-btn bac-btn-small"
            disabled={!json.ok}
            onClick={() => json.ok && setWs({ draft: json.formatted })}
          >
            {t('wsPrettyPrint')}
          </button>
        )}
        <div class="bac-spacer" />
        <button type="button" class="bac-btn bac-btn-small" disabled={!cfg.draft.trim()} onClick={saveMessage}>
          {t('wsSaveMessage')}
        </button>
        <button type="button" class="bac-btn bac-btn-small bac-btn-primary" disabled={!open || !cfg.draft} title={open ? t('wsSendTitle', SEND_SHORTCUT) : t('wsSendNeedsConnection')} onClick={send}>
          {t('wsSend')}
        </button>
      </div>
      <VarField
        class="bac-code-input"
        multiline
        aria-label={t('wsMessageLabel')}
        placeholder={cfg.draftFormat === 'json' ? '{ "type": "ping" }' : t('wsMessagePlaceholder')}
        spellcheck={false}
        value={cfg.draft}
        onValue={(draft) => setWs({ draft })}
      />
      <p class={`bac-ws-validity${json ? (json.ok ? ' is-ok' : ' is-bad') : ''}`} role="status">
        {json ? (json.ok ? t('wsJsonValid') : cfg.draft.trim() ? t('wsJsonInvalid', json.error) : '') : ''}
      </p>
      {!open && <p class="bac-muted bac-ws-hint">{t('wsSendNeedsConnection')}</p>}
    </div>
  );
}

function SavedMessages({ tabId, cfg, setWs, state, onLoaded }: { tabId: string; cfg: WsConfig; setWs: (p: Partial<WsConfig>) => void; state: WsSession['state'] | 'idle'; onLoaded: () => void }) {
  if (cfg.saved.length === 0) return <p class="bac-muted bac-pad">{t('wsSavedEmpty')}</p>;
  const edit = (id: string, patch: Partial<WsConfig['saved'][number]>) => setWs({ saved: cfg.saved.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  return (
    <ul class="bac-ws-saved">
      {cfg.saved.map((m) => (
        <li key={m.id} class="bac-ws-saved-item">
          <div class="bac-ws-saved-head">
            <input class="bac-input" aria-label={t('wsSavedNameLabel')} value={m.name} onInput={(e) => edit(m.id, { name: e.currentTarget.value })} />
            <span class="bac-subtab-badge">{m.format === 'json' ? 'JSON' : t('wsFormatText')}</span>
            <button
              type="button"
              class="bac-btn bac-btn-small bac-btn-primary"
              disabled={state !== 'open'}
              title={state === 'open' ? undefined : t('wsSendNeedsConnection')}
              aria-label={t('wsSendNamed', m.name)}
              onClick={() => {
                const out = sendWs(tabId, m.text, m.format);
                if (!out.ok) showToast(out.error);
              }}
            >
              {t('wsSend')}
            </button>
            <button
              type="button"
              class="bac-btn bac-btn-small"
              aria-label={t('wsEditNamed', m.name)}
              onClick={() => {
                setWs({ draft: m.text, draftFormat: m.format });
                onLoaded();
              }}
            >
              {t('wsEdit')}
            </button>
            <button type="button" class="bac-btn bac-btn-small bac-btn-ghost" aria-label={t('wsDeleteNamed', m.name)} onClick={() => setWs({ saved: cfg.saved.filter((x) => x.id !== m.id) })}>
              {t('commonDelete')}
            </button>
          </div>
          <pre class="bac-ws-saved-text bac-mono">{m.text.length > 400 ? `${m.text.slice(0, 400)}…` : m.text}</pre>
        </li>
      ))}
    </ul>
  );
}

function ConnectionSettings({ cfg, setWs }: { cfg: WsConfig; setWs: (p: Partial<WsConfig>) => void }) {
  const parsed = parseProtocols(cfg.protocols);
  return (
    <div class="bac-form">
      <label class="bac-field">
        <span class="bac-field-label">{t('wsProtocolsLabel')}</span>
        <VarField
          class="bac-input bac-mono"
          aria-label={t('wsProtocolsLabel')}
          placeholder="graphql-ws, v1.json"
          spellcheck={false}
          autocomplete="off"
          value={cfg.protocols}
          onValue={(protocols) => setWs({ protocols })}
        />
      </label>
      {parsed.invalid.length > 0 ? (
        <p class="bac-ws-validity is-bad" role="alert">
          {t('wsProtocolsInvalid', parsed.invalid.join(', '))}
        </p>
      ) : (
        <p class="bac-muted">{t('wsProtocolsHint')}</p>
      )}
      <div class="bac-notice bac-notice-warn" role="note">
        <strong>{t('wsHeadersNoticeTitle')}</strong> {t('wsHeadersNotice', '?token={{token}}')}
      </div>
    </div>
  );
}

// --- log ---

const prettyCache = new Map<number, string | null>();

function prettyOf(e: WsLogEntry): string | null {
  if (e.kind !== 'text' || e.text.length > 64 * 1024) return null;
  const head = e.text.trimStart()[0];
  if (head !== '{' && head !== '[') return null;
  if (prettyCache.has(e.id)) return prettyCache.get(e.id)!;
  const check = checkJson(e.text);
  const out = check.ok && check.formatted !== e.text ? check.formatted : null;
  if (prettyCache.size > 5000) prettyCache.clear();
  prettyCache.set(e.id, out);
  return out;
}

const DIR_LABEL: Record<WsDirection, () => string> = {
  sent: () => t('wsDirSent'),
  received: () => t('wsDirReceived'),
  system: () => t('wsDirEvent'),
};

export function WebSocketLog({ tabId }: { tabId: string }) {
  const session = useWs(tabId);
  const [query, setQuery] = useState('');
  const [dir, setDir] = useState<WsDirection | 'all' | 'messages'>('all');
  const [pretty, setPretty] = useState(true);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const log = session?.log;
  const shown = useMemo(() => filterLog(log ?? [], { query, dir }), [log, query, dir]);

  useEffect(() => {
    const el = listRef.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  const filtering = query.trim() !== '' || dir !== 'all';
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => showToast(t('wsCopied')), () => undefined);
  };
  const reuse = (e: WsLogEntry) => {
    updateRequest(tabId, (r) => ({ ...r, ws: { ...wsConfig(r), draft: e.text, draftFormat: checkJson(e.text).ok ? 'json' : 'text' } }));
    showToast(t('wsLoadedIntoComposer'));
  };

  return (
    <section class="bac-response bac-ws-log" aria-label={t('wsLogSectionLabel')}>
      <div class="bac-ws-log-bar">
        <input
          type="search"
          class="bac-input bac-ws-filter"
          aria-label={t('wsFilterLabel')}
          placeholder={t('wsFilterPlaceholder')}
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <select class="bac-select" aria-label={t('wsFilterDirectionLabel')} value={dir} onChange={(e) => setDir(e.currentTarget.value as typeof dir)}>
          <option value="all">{t('wsFilterAll')}</option>
          <option value="messages">{t('wsFilterMessages')}</option>
          <option value="sent">{t('wsDirSent')}</option>
          <option value="received">{t('wsDirReceived')}</option>
          <option value="system">{t('wsDirEvent')}</option>
        </select>
        <label class="bac-ws-check">
          <input type="checkbox" checked={pretty} onChange={(e) => setPretty(e.currentTarget.checked)} /> {t('wsPrettyJson')}
        </label>
        <label class="bac-ws-check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.currentTarget.checked)} /> {t('wsFollow')}
        </label>
        <div class="bac-spacer" />
        <span class="bac-muted bac-ws-count" role="status">
          {session ? (filtering ? t('wsCountFiltered', shown.length, log?.length ?? 0) : t('wsCountSentReceived', session.sent, session.received)) : ''}
        </span>
        <button type="button" class="bac-icon-btn" aria-label={t('wsCopyLog')} title={t('wsCopyLog')} disabled={!shown.length} onClick={() => copy(logToText(shown))}>
          <IconCopy />
        </button>
        <button
          type="button"
          class="bac-icon-btn"
          aria-label={t('wsDownloadLog')}
          title={t('wsDownloadLog')}
          disabled={!shown.length}
          onClick={() => downloadText(`${safeFileName(session?.url.replace(/^wss?:\/\//, '') ?? '', 'websocket')}-log.txt`, logToText(shown), 'text/plain')}
        >
          <IconDownload />
        </button>
        <button type="button" class="bac-btn bac-btn-small" disabled={!log?.length} onClick={() => clearWsLog(tabId)}>
          {t('wsClear')}
        </button>
      </div>
      {!log?.length ? (
        <div class="bac-empty">
          <p class="bac-empty-title">{t('wsLogEmptyTitle')}</p>
          <p class="bac-muted">{tParts('wsLogEmptyHint', <kbd>{SEND_SHORTCUT}</kbd>)}</p>
        </div>
      ) : (
        <>
          {session && session.dropped > 0 && <p class="bac-muted bac-pad">{t('wsLogDropped', session.dropped)}</p>}
          {shown.length === 0 && <p class="bac-muted bac-pad">{t('wsLogNoMatches')}</p>}
          <ol class="bac-ws-entries" role="log" aria-live="off" aria-label={t('wsLogListLabel')} tabIndex={0} ref={listRef}>
            {shown.map((e) => {
              const body = pretty ? prettyOf(e) ?? e.text : e.text;
              return (
                <li key={e.id} class={`bac-ws-entry is-${e.dir} k-${e.kind}`}>
                  <div class="bac-ws-entry-head">
                    <time class="bac-mono bac-muted">{formatLogTime(e.at)}</time>
                    <span class="bac-ws-dir">
                      <span aria-hidden="true">{e.dir === 'sent' ? '↑' : e.dir === 'received' ? '↓' : '•'}</span> {DIR_LABEL[e.dir]()}
                      {e.kind === 'binary' ? ` · ${t('wsBinary')}` : ''}
                    </span>
                    {e.size > 0 && <span class="bac-muted">{formatSize(e.size)}</span>}
                    <div class="bac-spacer" />
                    {(e.kind === 'text' || e.kind === 'binary') && (
                      <button type="button" class="bac-btn bac-btn-small bac-btn-ghost" aria-label={t('wsCopyEntry')} onClick={() => copy(e.text)}>
                        {t('commonCopy')}
                      </button>
                    )}
                    {e.kind === 'text' && (
                      <button type="button" class="bac-btn bac-btn-small bac-btn-ghost" aria-label={t('wsReuseEntry')} onClick={() => reuse(e)}>
                        {t('wsReuse')}
                      </button>
                    )}
                  </div>
                  <pre class="bac-ws-text bac-mono">{body}</pre>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
