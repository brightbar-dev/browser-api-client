/**
 * Send requests from the app page itself. Extension pages may fetch any host the
 * extension has permission for without CORS, and running here (not in the service worker)
 * gives real cancellation, streamed bodies and File uploads with no message-size limits.
 */

import { browser } from 'wxt/browser';
import type { ApiRequest, ApiResponse, FileRef, ResolvedBody, ResolvedRequest } from '@/utils/request';
import { generateId } from '@/utils/request';
import type { EnvVariable } from '@/utils/environment';
import { encodeUrlencoded, resolveRequest, type ResolveResult } from '@/utils/resolve';
import { impliedScheme, withDefaultScheme } from '@/utils/url';
import { classifyBody, decodeText, describeFetchError, isTextualKind, parseContentType, toHistoryResponse } from '@/utils/response';
import { describeNetError } from '@/utils/net-errors';
import type { FetchFailure } from '@/utils/response';
import { applyExtractions, describeAssertion, evaluateAssertions, runExtractions } from '@/utils/assertions';
import type { ExtractionResult, ResponseSnapshot } from '@/utils/assertions';
import { createSseParser, isEventStream, type SseEvent } from '@/utils/sse';
import { idbGet, idbPut } from '@/utils/idb';
import { activeVariables, findTab, getState, markWelcomed, setRun, updateRequest } from './store';
import { beginTrace, endTrace } from './network';
import { updateEnvironment } from './library';
import { interpolateOAuth, tokenForSend } from './oauth';
import type { ResponseData, TestResult } from './types';
import { t } from '@/utils/i18n';

/** Responses bigger than this are shown but not kept for the next reload. */
const MAX_STORED_RESPONSE = 10 * 1024 * 1024;

const controllers = new Map<string, AbortController>();

class RequestTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(t('errorTimeoutMessage', timeoutMs));
  }
}

class MissingFileError extends Error {
  constructor(public fileName: string) {
    super(t('errorFileMissingMessage', fileName));
  }
}

export function cancelSend(tabId: string): void {
  controllers.get(tabId)?.abort();
}

async function loadFile(ref: FileRef): Promise<Blob> {
  const blob = await idbGet<Blob>('files', ref.id);
  if (!blob) throw new MissingFileError(ref.name);
  return blob;
}

async function encodeBody(body: ResolvedBody): Promise<BodyInit | undefined> {
  switch (body.kind) {
    case 'none':
      return undefined;
    case 'text':
      return body.text;
    case 'urlencoded':
      return encodeUrlencoded(body.fields);
    case 'multipart': {
      const form = new FormData();
      for (const field of body.fields) {
        if (field.file) form.append(field.name, await loadFile(field.file), field.file.name);
        else form.append(field.name, field.value ?? '');
      }
      return form;
    }
    case 'binary':
      return loadFile(body.file);
  }
}

/** Resolve variables and auth, fetching an OAuth 2.0 token when the request needs one. */
export async function prepareRequest(request: ApiRequest, variables: EnvVariable[]): Promise<ResolveResult> {
  if (request.auth.type === 'oauth2' && request.auth.oauth2) {
    const token = await tokenForSend(interpolateOAuth(request.auth.oauth2, variables));
    return resolveRequest(request, variables, { oauthToken: token });
  }
  return resolveRequest(request, variables);
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export interface ExecuteOptions {
  signal: AbortSignal;
  sendCookies: boolean;
  /** Called as Server-Sent Events arrive (throttled); without it event streams are read to the end. */
  onEvents?: (response: ResponseData) => void;
  /** Abandon the request after this many milliseconds (0 or undefined: no limit). */
  timeoutMs?: number;
}

/** Perform one resolved request and read its whole response. */
export async function executeResolved(resolved: ResolvedRequest, opts: ExecuteOptions): Promise<ResponseData> {
  const timeout = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined;
  const signal = timeout ? AbortSignal.any([opts.signal, timeout]) : opts.signal;
  try {
    return await executeWithSignal(resolved, opts, signal);
  } catch (e) {
    if (timeout?.aborted && !opts.signal.aborted) throw new RequestTimeoutError(opts.timeoutMs!);
    throw e;
  }
}

async function executeWithSignal(resolved: ResolvedRequest, opts: ExecuteOptions, signal: AbortSignal): Promise<ResponseData> {
  const t0 = performance.now();
  const body = await encodeBody(resolved.body);
  const res = await fetch(resolved.url, {
    method: resolved.method,
    headers: resolved.headers,
    body,
    signal,
    // The browser's cookies for the site are attached only when the user asks.
    credentials: opts.sendCookies ? 'include' : 'omit',
    cache: 'no-store',
    redirect: 'follow',
  });
  const ttfb = performance.now() - t0;
  const headers: Array<[string, string]> = [];
  res.headers.forEach((value, name) => headers.push([name, value]));
  const contentType = res.headers.get('content-type') || '';

  const build = (bytes: Uint8Array, time: number, receivedAt: number): ResponseData => {
    const kind = classifyBody(contentType, bytes);
    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      url: res.url || resolved.url,
      redirected: res.redirected,
      contentType,
      kind,
      bytes,
      text: isTextualKind(kind) ? decodeText(bytes, parseContentType(contentType).charset) : undefined,
      size: bytes.byteLength,
      time,
      ttfb,
      receivedAt,
      method: resolved.method,
      requestUrl: resolved.url,
    };
  };

  if (isEventStream(contentType) && res.body && opts.onEvents) {
    const events: SseEvent[] = [];
    const chunks: Uint8Array[] = [];
    let size = 0;
    const startedAt = Date.now();
    const parser = createSseParser((e) => events.push(e));
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let lastEmit = 0;
    const emit = (force: boolean) => {
      const now = performance.now();
      if (!force && now - lastEmit < 80) return;
      lastEmit = now;
      opts.onEvents!({ ...build(concat(chunks, size), now - t0, startedAt), kind: 'text', events: [...events] });
    };
    emit(true);
    let stopped = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
        parser.push(decoder.decode(value, { stream: true }));
        emit(false);
      }
      parser.push(decoder.decode());
      parser.end();
    } catch (e) {
      if (!signal.aborted) throw e;
      stopped = true;
    }
    return { ...build(concat(chunks, size), performance.now() - t0, Date.now()), kind: 'text', events, streamStopped: stopped };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  return build(bytes, performance.now() - t0, Date.now());
}

export function snapshotOf(response: ResponseData): ResponseSnapshot {
  return { status: response.status, headers: response.headers, bodyText: response.text ?? '', time: response.time };
}

/** Write successful extractions into the active environment; returns a note for the UI. */
export function applyExtracted(results: ExtractionResult[]): string | undefined {
  if (!results.some((r) => r.ok)) return undefined;
  const s = getState();
  const env = s.environments.find((e) => e.id === s.activeEnvId);
  if (!env) return t('extractNoEnvNote');
  updateEnvironment(env.id, (e) => ({ ...e, variables: applyExtractions(e.variables, results) }));
  return t('extractSavedNote', env.name);
}

export function runTests(request: ApiRequest, response: ResponseData): { tests: TestResult[]; extracted: ExtractionResult[]; extractNote?: string } {
  const snapshot = snapshotOf(response);
  const assertions = request.assertions ?? [];
  const labels = new Map(assertions.map((a) => [a.id, describeAssertion(a)]));
  const tests = evaluateAssertions(assertions, snapshot).map((r) => ({ ...r, label: labels.get(r.id) ?? '' }));
  const extracted = runExtractions(request.extractions ?? [], snapshot);
  return { tests, extracted, extractNote: applyExtracted(extracted) };
}

function failureOf(err: unknown, cancelled: boolean, url: string, netError?: string): FetchFailure {
  if (err instanceof RequestTimeoutError) {
    return describeFetchError(err, { timedOut: true, timeoutMs: err.timeoutMs, url });
  }
  if (err instanceof MissingFileError) {
    return { title: t('errorFileMissingTitle'), detail: t('errorFileMissingDetail', err.fileName) };
  }
  if (err instanceof TypeError && /header/i.test(err.message)) {
    return { title: t('errorHeaderTitle'), detail: t('errorHeaderDetail', err.message) };
  }
  if (!cancelled && netError && !/ERR_ABORTED$/.test(netError)) {
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      // keep empty
    }
    const info = describeNetError(netError, host);
    return { title: info.title, detail: info.detail };
  }
  return describeFetchError(err, { cancelled, url });
}

export async function sendTab(tabId: string): Promise<void> {
  if (controllers.has(tabId) || !findTab(tabId)) return;

  // A URL typed without a scheme gets one, visibly, before it is sent.
  if (impliedScheme(findTab(tabId)!.request.url)) {
    updateRequest(tabId, (r) => ({ ...r, url: withDefaultScheme(r.url) }));
  }
  const request = findTab(tabId)!.request;
  markWelcomed();
  const previous = getState().runs[tabId]?.response;
  const controller = new AbortController();
  controllers.set(tabId, controller);
  const startedAt = Date.now();
  setRun(tabId, { state: 'sending', startedAt, warnings: [], response: previous });

  let prepared: ResolveResult;
  try {
    prepared = await prepareRequest(request, activeVariables());
  } catch (e) {
    controllers.delete(tabId);
    setRun(tabId, { state: 'error', error: { title: t('errorOAuthTitle'), detail: (e as Error).message }, warnings: [], response: previous });
    return;
  }
  const { request: resolved, warnings, error } = prepared;
  if (error) {
    controllers.delete(tabId);
    setRun(tabId, { state: 'error', error: { title: t('errorCannotSendTitle'), detail: error }, warnings, response: previous });
    return;
  }
  if (controller.signal.aborted) {
    controllers.delete(tabId);
    setRun(tabId, { state: 'error', error: failureOf(null, true, resolved.url), warnings, response: previous });
    return;
  }
  setRun(tabId, { state: 'sending', startedAt, warnings, response: previous });
  const t0 = performance.now();
  const trace = beginTrace(resolved.method, resolved.url);

  try {
    const executed = await executeResolved(resolved, {
      signal: controller.signal,
      sendCookies: !!request.sendCookies,
      timeoutMs: getState().requestTimeout * 1000,
      onEvents: (partial) => {
        if (findTab(tabId)) setRun(tabId, { state: 'streaming', startedAt, warnings, response: partial });
      },
    });
    const network = await endTrace(trace);
    const response: typeof executed = { ...executed, redirects: network.hops, cookies: network.cookies };
    if (findTab(tabId)) {
      const results = runTests(request, response);
      setRun(tabId, { state: 'done', response, warnings, ...results });
      if (response.size <= MAX_STORED_RESPONSE) idbPut('responses', tabId, response).catch(() => undefined);
    }
    recordHistory(request, toHistoryResponse({ ...response }), startedAt);
  } catch (err) {
    const cancelled = controller.signal.aborted;
    const network = await endTrace(trace);
    const failure = failureOf(err, cancelled, resolved.url, network.errorCode);
    if (findTab(tabId)) setRun(tabId, { state: 'error', error: failure, warnings, response: previous });
    if (!cancelled) {
      recordHistory(
        request,
        { status: 0, statusText: failure.title, headers: {}, body: '', size: 0, time: Math.round(performance.now() - t0), contentType: '' },
        startedAt,
      );
    }
  } finally {
    controllers.delete(tabId);
  }
}

function recordHistory(request: ApiRequest, response: ApiResponse, timestamp: number) {
  const entry = { id: generateId(), request: JSON.parse(JSON.stringify(request)), response, timestamp };
  browser.runtime.sendMessage({ action: 'addHistory', entry }).catch((e) => console.warn('Could not save history:', e));
}

export { failureOf };
