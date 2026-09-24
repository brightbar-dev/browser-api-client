import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { formatSize, formatTime, prettyJson, statusColor } from '@/utils/request';
import { downloadFileName, findMatches, hexDump, type BodyKind } from '@/utils/response';
import { statusLabel } from '@/utils/http-status';
import { tokenizeJson } from '@/utils/json-highlight';
import { parseSetCookie } from '@/utils/set-cookie';
import { openDialog, useApp } from '../store';
import { cancelSend } from '../send';
import type { ResponseData, TabRun } from '../types';
import { JsonTree } from './JsonTree';
import { SEND_SHORTCUT } from './RequestEditor';
import { IconChevronDown, IconChevronUp, IconCopy, IconDownload, IconSearch } from './icons';
import { t, tParts } from '@/utils/i18n';
import { showReviewNudge } from '@/utils/review-nudge';

type Mode = 'pretty' | 'tree' | 'raw' | 'preview' | 'hex';
const MODE_LABELS: Record<Mode, string> = {
  pretty: t('responseModePretty'),
  tree: t('responseModeTree'),
  raw: t('responseModeRaw'),
  preview: t('responseModePreview'),
  hex: t('responseModeHex'),
};
const modeMemory = new Map<string, Mode>();

function modesFor(kind: BodyKind): Mode[] {
  switch (kind) {
    case 'json':
      return ['pretty', 'tree', 'raw'];
    case 'html':
      return ['preview', 'raw'];
    case 'image':
      return ['preview', 'hex'];
    case 'binary':
      return ['hex'];
    case 'empty':
      return [];
    default:
      return ['raw'];
  }
}

/** Syntax colouring is skipped above this size to keep large responses responsive. */
const HIGHLIGHT_LIMIT = 200 * 1024;
const MAX_MARKS = 1000;

export function ResponsePane({ tabId }: { tabId: string }) {
  const run = useApp((s) => s.runs[tabId]);

  return (
    <section class="bac-response" aria-label={t('responseSectionLabel')} aria-busy={run?.state === 'sending' || run?.state === 'streaming'}>
      {!run && <EmptyResponse />}
      {run?.state === 'sending' && <SendingBar startedAt={run.startedAt ?? Date.now()} onCancel={() => cancelSend(tabId)} />}
      {run?.state === 'streaming' && (
        <div class="bac-sending" role="status">
          <span class="bac-live-dot" aria-hidden="true" />
          <span>{t('responseReceivingEvents', run.response?.events?.length ?? 0)}</span>
          <button type="button" class="bac-btn bac-btn-small" onClick={() => cancelSend(tabId)}>
            {t('commonStop')}
          </button>
        </div>
      )}
      {run && run.warnings.length > 0 && (
        <ul class="bac-notice bac-notice-warn bac-warnings" aria-label={t('responseWarningsLabel')}>
          {run.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {run?.state === 'error' && run.error && (
        <div class="bac-error-card" role="alert">
          <h2>{run.error.title}</h2>
          <p>{run.error.detail}</p>
        </div>
      )}
      {run?.response && run.state !== 'error' && <ResponseView tabId={tabId} run={run} response={run.response} stale={run.state === 'sending'} />}
    </section>
  );
}

function EmptyResponse() {
  const welcomed = useApp((s) => s.welcomed);
  if (!welcomed) {
    return (
      <div class="bac-empty bac-welcome">
        <p class="bac-empty-title">{t('responseWelcomeTitle')}</p>
        <ul class="bac-welcome-list">
          <li>{tParts('responseWelcomeSample', <strong>httpbin.org</strong>, <kbd>{t('requestSend')}</kbd>, <kbd>{SEND_SHORTCUT}</kbd>)}</li>
          <li>{t('responseWelcomePrivacy')}</li>
          <li>{tParts('responseWelcomeImport', <strong>{t('importButton')}</strong>)}</li>
          <li>
            {tParts(
              'responseWelcomeShortcuts',
              <button type="button" class="bac-link-btn" onClick={() => openDialog({ type: 'shortcuts' })}>
                {tParts('responseWelcomeShortcutsLink', <kbd>?</kbd>)}
              </button>,
            )}
          </li>
        </ul>
      </div>
    );
  }
  return (
    <div class="bac-empty">
      <p class="bac-empty-title">{t('responseEmptyTitle')}</p>
      <p class="bac-muted">{tParts('responseEmptyHint', <kbd>{t('requestSend')}</kbd>, <kbd>{SEND_SHORTCUT}</kbd>)}</p>
      <ReviewNudgeSlot />
    </div>
  );
}

/** The one-time review request, in the idle response pane of a freshly opened app tab only (utils/review-nudge.ts). */
function ReviewNudgeSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) void showReviewNudge(ref.current);
  }, []);
  return <div class="bac-review-nudge" ref={ref} />;
}

function SendingBar({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  return (
    <div class="bac-sending" role="status">
      <span class="bac-spinner" aria-hidden="true" />
      <span>{t('responseSending', formatTime(now - startedAt))}</span>
      <button type="button" class="bac-btn bac-btn-small" onClick={onCancel}>
        {t('commonCancel')}
      </button>
    </div>
  );
}

type ResTab = 'events' | 'body' | 'headers' | 'cookies' | 'tests';
const resTabMemory = new Map<string, ResTab>();

function ResponseView({ tabId, run, response, stale }: { tabId: string; run: TabRun; response: ResponseData; stale: boolean }) {
  const hasEvents = response.events !== undefined;
  const tests = run.tests ?? [];
  const extracted = run.extracted ?? [];
  const hasTests = tests.length > 0 || extracted.length > 0;
  const hasCookies = (response.cookies?.length ?? 0) > 0;
  const available: ResTab[] = [...(hasEvents ? (['events'] as const) : []), 'body', 'headers', ...(hasCookies ? (['cookies'] as const) : []), ...(hasTests ? (['tests'] as const) : [])];
  const [chosen, setChosen] = useState<ResTab>(() => resTabMemory.get(tabId) ?? (hasEvents ? 'events' : 'body'));
  const tab: ResTab = available.includes(chosen) ? chosen : (available[0] ?? 'body');
  const setTab = (t: ResTab) => {
    resTabMemory.set(tabId, t);
    setChosen(t);
  };
  const color = statusColor(response.status);
  const download = Math.max(0, response.time - response.ttfb);
  const passed = tests.filter((t) => t.pass).length;
  const labels: Record<ResTab, string> = {
    events: t('responseTabEvents'),
    body: t('responseTabBody'),
    headers: t('responseTabHeaders'),
    cookies: t('responseTabCookies'),
    tests: t('responseTabTests'),
  };
  const badges: Partial<Record<ResTab, string>> = {
    events: String(response.events?.length ?? 0),
    headers: String(response.headers.length),
    cookies: String(response.cookies?.length ?? 0),
    tests: tests.length ? `${passed}/${tests.length}` : extracted.length ? String(extracted.length) : undefined,
  };

  return (
    <div class={`bac-response-view${stale ? ' is-stale' : ''}`}>
      <div class="bac-response-bar">
        <span class={`bac-status s-${color}`}>{statusLabel(response.status, response.statusText)}</span>
        <span class="bac-metric" title={t('responseTimingTitle', formatTime(response.ttfb), formatTime(download))}>
          {formatTime(response.time)}
        </span>
        <span class="bac-metric">{formatSize(response.size)}</span>
        {response.redirected && (
          <button type="button" class="bac-badge" title={t('responseRedirectedTitle', response.url)} onClick={() => setTab('headers')}>
            {response.redirects?.length
              ? response.redirects.length === 1
                ? t('responseRedirectsOne', 1)
                : t('responseRedirectsOther', response.redirects.length)
              : t('responseRedirected')}{' '}
            → {shortUrl(response.url)}
          </button>
        )}
        {tests.length > 0 && (
          <button type="button" class={`bac-test-pill${passed === tests.length ? ' is-pass' : ' is-fail'}`} onClick={() => setTab('tests')}>
            {passed === tests.length ? `✓ ${t('testsCountPassed', passed)}` : `✗ ${t('testsCountFailed', tests.length - passed)}`}
          </button>
        )}
        <div class="bac-spacer" />
        <div role="tablist" aria-label={t('responsePartsLabel')} class="bac-subtabs bac-subtabs-inline">
          {available.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`bac-res-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="bac-res-panel"
              class={`bac-subtab${tab === t ? ' is-active' : ''}`}
              onClick={() => setTab(t)}
            >
              {labels[t]}
              {t !== 'body' && badges[t] && <span class={`bac-subtab-badge${t === 'tests' && passed < tests.length ? ' is-fail' : ''}`}>{badges[t]}</span>}
            </button>
          ))}
        </div>
      </div>
      <div class="bac-response-panel" role="tabpanel" id="bac-res-panel" aria-labelledby={`bac-res-tab-${tab}`}>
        {tab === 'body' && <BodyViewer key={`${response.receivedAt}`} tabId={tabId} response={response} />}
        {tab === 'headers' && <HeadersTable response={response} />}
        {tab === 'cookies' && <CookiesView response={response} />}
        {tab === 'tests' && <TestsView run={run} />}
        {tab === 'events' && <EventsView response={response} live={run.state === 'streaming'} />}
      </div>
    </div>
  );
}

function TestsView({ run }: { run: TabRun }) {
  const tests = run.tests ?? [];
  const extracted = run.extracted ?? [];
  const passed = tests.filter((t) => t.pass).length;
  return (
    <div class="bac-scroll bac-results">
      {tests.length > 0 && (
        <section>
          <h3 class="bac-results-title">{passed === tests.length ? t('responseAllTestsPassed', tests.length) : t('responseSomeTestsFailed', tests.length - passed, tests.length)}</h3>
          <ul class="bac-test-list">
            {tests.map((test) => (
              <li key={test.id} class={test.pass ? 'is-pass' : 'is-fail'}>
                <span class="bac-test-icon" aria-hidden="true">
                  {test.pass ? '✓' : '✗'}
                </span>
                <span>
                  <span class="bac-visually-hidden">
                    {test.pass ? t('responseTestPassed') : t('responseTestFailed')}{' '}
                  </span>
                  <span class="bac-test-label">{test.label}</span>
                  {!test.pass && <span class="bac-test-msg">{test.message}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {extracted.length > 0 && (
        <section>
          <h3 class="bac-results-title">{t('responseExtractedTitle')}</h3>
          <ul class="bac-test-list">
            {extracted.map((x) => (
              <li key={x.id} class={x.ok ? 'is-pass' : 'is-fail'}>
                <span class="bac-test-icon" aria-hidden="true">
                  {x.ok ? '✓' : '✗'}
                </span>
                <span>
                  <code>{`{{${x.variable}}}`}</code>{' '}
                  {x.ok ? (
                    <>
                      = <code class="bac-break">{x.value.length > 120 ? `${x.value.slice(0, 120)}…` : x.value}</code>
                    </>
                  ) : (
                    <span class="bac-test-msg">{x.message}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {run.extractNote && <p class="bac-muted bac-small">{run.extractNote}</p>}
        </section>
      )}
    </div>
  );
}

function EventsView({ response, live }: { response: ResponseData; live: boolean }) {
  const events = response.events ?? [];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length, live]);
  if (!events.length) {
    return <p class="bac-muted bac-pad">{live ? t('responseEventsWaiting') : t('responseEventsNone')}</p>;
  }
  const first = events[0]!.receivedAt;
  return (
    <div class="bac-scroll" ref={ref}>
      <table class="bac-table bac-events-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{t('responseEventsArrived')}</th>
            <th scope="col">{t('responseEventsEvent')}</th>
            <th scope="col">{t('responseEventsId')}</th>
            <th scope="col">{t('responseEventsData')}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td class="bac-mono">{i + 1}</td>
              <td class="bac-mono">+{formatTime(e.receivedAt - first)}</td>
              <td class="bac-mono">{e.event}</td>
              <td class="bac-mono">{e.id}</td>
              <td class="bac-mono bac-break">{e.data}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!live && <p class="bac-muted bac-pad">{response.streamStopped ? t('responseEventsStopped', events.length) : t('responseEventsClosed', events.length)}</p>}
    </div>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function HeadersTable({ response }: { response: ResponseData }) {
  const hops = response.redirects ?? [];
  const cookieHeaders = (response.cookies ?? []).filter((c) => c.url === response.url);
  return (
    <div class="bac-scroll">
      {hops.length > 0 && (
        <section class="bac-redirects" aria-label={t('responseRedirectChain')}>
          <h3 class="bac-results-title">{t('responseRedirectChain')}</h3>
          <ol class="bac-hops">
            {hops.map((hop, i) => (
              <li key={i}>
                <span class={`bac-status-text s-${statusColor(hop.status)}`}>{hop.status}</span> <span class="bac-mono bac-break">{hop.url}</span>
              </li>
            ))}
            <li>
              <span class={`bac-status-text s-${statusColor(response.status)}`}>{response.status}</span> <span class="bac-mono bac-break">{response.url}</span>
            </li>
          </ol>
        </section>
      )}
      <table class="bac-table">
        <thead>
          <tr>
            <th scope="col">{t('commonName')}</th>
            <th scope="col">{t('commonValue')}</th>
          </tr>
        </thead>
        <tbody>
          {response.headers.map(([name, value], i) => (
            <tr key={i}>
              <td class="bac-mono">{name}</td>
              <td class="bac-mono bac-break">{value}</td>
            </tr>
          ))}
          {cookieHeaders.map((c, i) => (
            <tr key={`c${i}`}>
              <td class="bac-mono">set-cookie</td>
              <td class="bac-mono bac-break">{c.header}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {response.cookies === undefined && <p class="bac-muted bac-pad">{t('responseSetCookieUnavailable')}</p>}
    </div>
  );
}

function CookiesView({ response }: { response: ResponseData }) {
  const cookies = (response.cookies ?? []).map((c) => ({ ...parseSetCookie(c.header), from: c.url }));
  return (
    <div class="bac-scroll">
      <table class="bac-table bac-cookies-table">
        <thead>
          <tr>
            <th scope="col">{t('commonName')}</th>
            <th scope="col">{t('commonValue')}</th>
            <th scope="col">{t('responseCookieDomainPath')}</th>
            <th scope="col">{t('responseCookieExpires')}</th>
            <th scope="col">{t('responseCookieFlags')}</th>
          </tr>
        </thead>
        <tbody>
          {cookies.map((c, i) => (
            <tr key={i} title={t('responseCookieSetBy', c.from)}>
              <td class="bac-mono">{c.name}</td>
              <td class="bac-mono bac-break">{c.value}</td>
              <td class="bac-mono">
                {c.domain ?? t('responseCookieThisHost')} {c.path ?? '/'}
              </td>
              <td class="bac-mono">{c.maxAge ? t('responseCookieMaxAge', c.maxAge) : (c.expires ?? t('responseCookieSession'))}</td>
              <td class="bac-small">{[c.httpOnly && 'HttpOnly', c.secure && 'Secure', c.sameSite && `SameSite=${c.sameSite}`, c.partitioned && 'Partitioned'].filter(Boolean).join(' · ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="bac-muted bac-pad">{t('responseCookiesNote', t('requestSendCookies'))}</p>
    </div>
  );
}

function BodyViewer({ tabId, response }: { tabId: string; response: ResponseData }) {
  const modes = modesFor(response.kind);
  const memoryKey = `${tabId}:${response.kind}`;
  const [mode, setModeState] = useState<Mode>(() => {
    const remembered = modeMemory.get(memoryKey);
    return remembered && modes.includes(remembered) ? remembered : (modes[0] ?? 'raw');
  });
  const setMode = (m: Mode) => {
    modeMemory.set(memoryKey, m);
    setModeState(m);
  };
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);

  const pretty = useMemo(() => (response.kind === 'json' && response.text ? prettyJson(response.text) : (response.text ?? '')), [response]);
  const text = mode === 'pretty' ? pretty : mode === 'raw' ? (response.text ?? '') : '';
  const matches = useMemo(() => findMatches(text, query), [text, query]);
  const searchable = mode === 'pretty' || mode === 'raw';

  useEffect(() => setCurrent(0), [query, mode]);

  if (response.kind === 'empty') {
    return <p class="bac-muted bac-pad">{t('responseNoBody')}</p>;
  }

  const step = (dir: 1 | -1) => {
    if (!matches.length) return;
    setCurrent((c) => (c + dir + Math.min(matches.length, MAX_MARKS)) % Math.min(matches.length, MAX_MARKS));
  };

  return (
    <div class="bac-bodyview">
      <div class="bac-body-toolbar">
        {modes.length > 1 && (
          <div class="bac-segmented bac-segmented-small" role="radiogroup" aria-label={t('responseBodyViewLabel')}>
            {modes.map((m) => (
              <label key={m} class={`bac-seg${mode === m ? ' is-on' : ''}`}>
                <input type="radio" name={`bac-bodyview-${tabId}`} checked={mode === m} onChange={() => setMode(m)} />
                {MODE_LABELS[m]}
              </label>
            ))}
          </div>
        )}
        {searchable && (
          <div class="bac-search" role="search">
            <IconSearch />
            <input
              type="search"
              class="bac-search-input"
              placeholder={t('responseFindPlaceholder')}
              aria-label={t('responseFindLabel')}
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  step(e.shiftKey ? -1 : 1);
                }
              }}
            />
            {query && (
              <span class="bac-search-count" aria-live="polite">
                {matches.length ? t('responseMatchCount', current + 1, matches.length >= 5000 ? '5000+' : matches.length) : t('responseNoMatches')}
              </span>
            )}
            <button type="button" class="bac-icon-btn" aria-label={t('responsePrevMatch')} disabled={!matches.length} onClick={() => step(-1)}>
              <IconChevronUp />
            </button>
            <button type="button" class="bac-icon-btn" aria-label={t('responseNextMatch')} disabled={!matches.length} onClick={() => step(1)}>
              <IconChevronDown />
            </button>
          </div>
        )}
        <div class="bac-spacer" />
        {response.text !== undefined && (
          <button type="button" class="bac-btn bac-btn-small" onClick={() => void navigator.clipboard.writeText(mode === 'pretty' ? pretty : (response.text ?? ''))}>
            <IconCopy /> {t('commonCopy')}
          </button>
        )}
        <button type="button" class="bac-btn bac-btn-small" onClick={() => downloadResponse(response)}>
          <IconDownload /> {t('responseDownload')}
        </button>
      </div>
      <div class="bac-body-content">
        {searchable && <CodeView text={text} json={mode === 'pretty' && response.kind === 'json'} matches={query ? matches : []} current={current} />}
        {mode === 'tree' && <TreeView text={response.text ?? ''} />}
        {mode === 'preview' && response.kind === 'html' && (
          <iframe class="bac-preview-frame" sandbox="" srcdoc={response.text} title={t('responseHtmlPreviewTitle')} />
        )}
        {mode === 'preview' && response.kind === 'image' && <ImagePreview response={response} />}
        {mode === 'hex' && <BinaryView response={response} />}
      </div>
    </div>
  );
}

function CodeView({ text, json, matches, current }: { text: string; json: boolean; matches: Array<[number, number]>; current: number }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    ref.current?.querySelector('mark.is-current')?.scrollIntoView({ block: 'center' });
  }, [current, matches]);

  let content: ComponentChildren;
  if (matches.length) {
    const parts: ComponentChildren[] = [];
    let last = 0;
    matches.slice(0, MAX_MARKS).forEach(([start, end], i) => {
      parts.push(text.slice(last, start));
      parts.push(
        <mark key={i} class={i === current ? 'is-current' : undefined}>
          {text.slice(start, end)}
        </mark>,
      );
      last = end;
    });
    parts.push(text.slice(last));
    content = parts;
  } else if (json && text.length <= HIGHLIGHT_LIMIT) {
    content = tokenizeJson(text).map((tok, i) =>
      tok.type === 'plain' || tok.type === 'punct' ? tok.text : (
        <span key={i} class={`j-${tok.type}`}>
          {tok.text}
        </span>
      ),
    );
  } else {
    content = text;
  }
  return (
    <pre class="bac-code" ref={ref} tabIndex={0}>
      {content}
    </pre>
  );
}

function TreeView({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  }, [text]);
  if (!parsed.ok) return <p class="bac-notice bac-notice-warn">{t('responseInvalidJson', parsed.message)}</p>;
  return <JsonTree value={parsed.value} />;
}

function useObjectUrl(bytes: Uint8Array, type: string): string {
  const url = useMemo(() => URL.createObjectURL(new Blob([bytes as BlobPart], { type })), [bytes, type]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return url;
}

function ImagePreview({ response }: { response: ResponseData }) {
  const url = useObjectUrl(response.bytes, response.contentType);
  const [dims, setDims] = useState<string>('');
  return (
    <div class="bac-image-preview">
      <img
        src={url}
        alt={t('responseImageAlt', shortUrl(response.url))}
        onLoad={(e) => setDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
      />
      <p class="bac-muted">
        {response.contentType || t('responseImageFallbackType')} · {formatSize(response.size)}
        {dims && ` · ${dims}`}
      </p>
    </div>
  );
}

function BinaryView({ response }: { response: ResponseData }) {
  const dump = useMemo(() => hexDump(response.bytes, 1024), [response]);
  return (
    <div class="bac-binary">
      <p class="bac-muted bac-pad">
        {t('responseBinarySummary', response.contentType || t('responseNoContentType'), formatSize(response.size), Math.min(response.size, 1024))}
      </p>
      <pre class="bac-code">{dump}</pre>
    </div>
  );
}

function downloadResponse(response: ResponseData) {
  const url = URL.createObjectURL(new Blob([response.bytes as BlobPart], { type: response.contentType || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadFileName(response.url, response.contentType);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
