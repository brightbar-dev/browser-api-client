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

type Mode = 'pretty' | 'tree' | 'raw' | 'preview' | 'hex';
const MODE_LABELS: Record<Mode, string> = { pretty: 'Pretty', tree: 'Tree', raw: 'Raw', preview: 'Preview', hex: 'Hex' };
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
    <section class="bac-response" aria-label="Response" aria-busy={run?.state === 'sending' || run?.state === 'streaming'}>
      {!run && <EmptyResponse />}
      {run?.state === 'sending' && <SendingBar startedAt={run.startedAt ?? Date.now()} onCancel={() => cancelSend(tabId)} />}
      {run?.state === 'streaming' && (
        <div class="bac-sending" role="status">
          <span class="bac-live-dot" aria-hidden="true" />
          <span>Receiving events… {run.response?.events?.length ?? 0} so far</span>
          <button type="button" class="bac-btn bac-btn-small" onClick={() => cancelSend(tabId)}>
            Stop
          </button>
        </div>
      )}
      {run && run.warnings.length > 0 && (
        <ul class="bac-notice bac-notice-warn bac-warnings" aria-label="Warnings">
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
        <p class="bac-empty-title">Welcome to Browser API Client</p>
        <ul class="bac-welcome-list">
          <li>
            The tab above is a sample request to <strong>httpbin.org</strong>, a public echo service. Nothing is sent until you press <kbd>Send</kbd> or <kbd>{SEND_SHORTCUT}</kbd>.
          </li>
          <li>No account, no sync, no tracking — your requests, tokens and collections stay in this browser.</li>
          <li>
            Already have requests? Use <strong>Import</strong> for a cURL command, an OpenAPI spec, a Postman collection or a HAR file.
          </li>
          <li>
            Press{' '}
            <button type="button" class="bac-link-btn" onClick={() => openDialog({ type: 'shortcuts' })}>
              <kbd>?</kbd> for keyboard shortcuts
            </button>
            .
          </li>
        </ul>
      </div>
    );
  }
  return (
    <div class="bac-empty">
      <p class="bac-empty-title">No response yet</p>
      <p class="bac-muted">
        Enter a URL and press <kbd>Send</kbd> or <kbd>{SEND_SHORTCUT}</kbd>. The response appears here with its status, timing, headers and body.
      </p>
    </div>
  );
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
      <span>Sending… {formatTime(now - startedAt)}</span>
      <button type="button" class="bac-btn bac-btn-small" onClick={onCancel}>
        Cancel
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
  const labels: Record<ResTab, string> = { events: 'Events', body: 'Body', headers: 'Headers', cookies: 'Cookies', tests: 'Tests' };
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
        <span class="bac-metric" title={`Waiting for headers ${formatTime(response.ttfb)} · Downloading body ${formatTime(download)}`}>
          {formatTime(response.time)}
        </span>
        <span class="bac-metric">{formatSize(response.size)}</span>
        {response.redirected && (
          <button type="button" class="bac-badge" title={`Redirects were followed. Final URL: ${response.url}`} onClick={() => setTab('headers')}>
            {response.redirects?.length ? `${response.redirects.length} redirect${response.redirects.length === 1 ? '' : 's'}` : 'Redirected'} → {shortUrl(response.url)}
          </button>
        )}
        {tests.length > 0 && (
          <button type="button" class={`bac-test-pill${passed === tests.length ? ' is-pass' : ' is-fail'}`} onClick={() => setTab('tests')}>
            {passed === tests.length ? `✓ ${passed} passed` : `✗ ${tests.length - passed} failed`}
          </button>
        )}
        <div class="bac-spacer" />
        <div role="tablist" aria-label="Response parts" class="bac-subtabs bac-subtabs-inline">
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
          <h3 class="bac-results-title">{passed === tests.length ? `All ${tests.length} tests passed` : `${tests.length - passed} of ${tests.length} tests failed`}</h3>
          <ul class="bac-test-list">
            {tests.map((t) => (
              <li key={t.id} class={t.pass ? 'is-pass' : 'is-fail'}>
                <span class="bac-test-icon" aria-hidden="true">
                  {t.pass ? '✓' : '✗'}
                </span>
                <span>
                  <span class="bac-visually-hidden">{t.pass ? 'Passed: ' : 'Failed: '}</span>
                  <span class="bac-test-label">{t.label}</span>
                  {!t.pass && <span class="bac-test-msg">{t.message}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {extracted.length > 0 && (
        <section>
          <h3 class="bac-results-title">Variables from this response</h3>
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
    return <p class="bac-muted bac-pad">{live ? 'Connected. Waiting for the first event…' : 'The stream ended without sending any events.'}</p>;
  }
  const first = events[0]!.receivedAt;
  return (
    <div class="bac-scroll" ref={ref}>
      <table class="bac-table bac-events-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Arrived</th>
            <th scope="col">Event</th>
            <th scope="col">ID</th>
            <th scope="col">Data</th>
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
      {!live && <p class="bac-muted bac-pad">{response.streamStopped ? `You stopped the stream after ${events.length} events.` : `The server closed the stream after ${events.length} events.`}</p>}
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
        <section class="bac-redirects" aria-label="Redirect chain">
          <h3 class="bac-results-title">Redirect chain</h3>
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
            <th scope="col">Name</th>
            <th scope="col">Value</th>
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
      {response.cookies === undefined && <p class="bac-muted bac-pad">Set-Cookie headers can’t be shown in this browser, so they are not listed here.</p>}
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
            <th scope="col">Name</th>
            <th scope="col">Value</th>
            <th scope="col">Domain / Path</th>
            <th scope="col">Expires</th>
            <th scope="col">Flags</th>
          </tr>
        </thead>
        <tbody>
          {cookies.map((c, i) => (
            <tr key={i} title={`Set by ${c.from}`}>
              <td class="bac-mono">{c.name}</td>
              <td class="bac-mono bac-break">{c.value}</td>
              <td class="bac-mono">
                {c.domain ?? '(this host)'} {c.path ?? '/'}
              </td>
              <td class="bac-mono">{c.maxAge ? `in ${c.maxAge} s` : (c.expires ?? 'session')}</td>
              <td class="bac-small">{[c.httpOnly && 'HttpOnly', c.secure && 'Secure', c.sameSite && `SameSite=${c.sameSite}`, c.partitioned && 'Partitioned'].filter(Boolean).join(' · ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="bac-muted bac-pad">These cookies came with the response. They are not added to your browser unless the request was sent with “Send this site’s cookies”.</p>
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
    return <p class="bac-muted bac-pad">The response has no body.</p>;
  }

  const step = (dir: 1 | -1) => {
    if (!matches.length) return;
    setCurrent((c) => (c + dir + Math.min(matches.length, MAX_MARKS)) % Math.min(matches.length, MAX_MARKS));
  };

  return (
    <div class="bac-bodyview">
      <div class="bac-body-toolbar">
        {modes.length > 1 && (
          <div class="bac-segmented bac-segmented-small" role="radiogroup" aria-label="Body view">
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
              placeholder="Find in body"
              aria-label="Find in response body"
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
                {matches.length ? `${current + 1} of ${matches.length >= 5000 ? '5000+' : matches.length}` : 'No matches'}
              </span>
            )}
            <button type="button" class="bac-icon-btn" aria-label="Previous match" disabled={!matches.length} onClick={() => step(-1)}>
              <IconChevronUp />
            </button>
            <button type="button" class="bac-icon-btn" aria-label="Next match" disabled={!matches.length} onClick={() => step(1)}>
              <IconChevronDown />
            </button>
          </div>
        )}
        <div class="bac-spacer" />
        {response.text !== undefined && (
          <button type="button" class="bac-btn bac-btn-small" onClick={() => void navigator.clipboard.writeText(mode === 'pretty' ? pretty : (response.text ?? ''))}>
            <IconCopy /> Copy
          </button>
        )}
        <button type="button" class="bac-btn bac-btn-small" onClick={() => downloadResponse(response)}>
          <IconDownload /> Download
        </button>
      </div>
      <div class="bac-body-content">
        {searchable && <CodeView text={text} json={mode === 'pretty' && response.kind === 'json'} matches={query ? matches : []} current={current} />}
        {mode === 'tree' && <TreeView text={response.text ?? ''} />}
        {mode === 'preview' && response.kind === 'html' && (
          <iframe class="bac-preview-frame" sandbox="" srcdoc={response.text} title="HTML preview (scripts disabled)" />
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
  if (!parsed.ok) return <p class="bac-notice bac-notice-warn">This body isn’t valid JSON: {parsed.message}</p>;
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
        alt={`Image response from ${shortUrl(response.url)}`}
        onLoad={(e) => setDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
      />
      <p class="bac-muted">
        {response.contentType || 'image'} · {formatSize(response.size)}
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
        Binary response · {response.contentType || 'no content type'} · {formatSize(response.size)}. The first {Math.min(response.size, 1024)} bytes are shown; download it to see the rest.
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
