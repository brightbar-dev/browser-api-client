/**
 * Send a tab's request from the app page itself. Extension pages may fetch any host the
 * extension has permission for without CORS, and running here (not in the service worker)
 * gives real cancellation, streamed bodies and File uploads with no message-size limits.
 */

import { browser } from 'wxt/browser';
import type { ApiRequest, ApiResponse, FileRef, ResolvedBody } from '@/utils/request';
import { generateId } from '@/utils/request';
import { encodeUrlencoded, resolveRequest } from '@/utils/resolve';
import { impliedScheme, withDefaultScheme } from '@/utils/url';
import { classifyBody, decodeText, describeFetchError, isTextualKind, parseContentType, toHistoryResponse } from '@/utils/response';
import type { FetchFailure } from '@/utils/response';
import { idbGet, idbPut } from '@/utils/idb';
import { activeVariables, findTab, getState, setRun, updateRequest } from './store';
import type { ResponseData } from './types';

/** Responses bigger than this are shown but not kept for the next reload. */
const MAX_STORED_RESPONSE = 10 * 1024 * 1024;

const controllers = new Map<string, AbortController>();

class MissingFileError extends Error {
  constructor(public fileName: string) {
    super(`File "${fileName}" is no longer available`);
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

export async function sendTab(tabId: string): Promise<void> {
  if (controllers.has(tabId) || !findTab(tabId)) return;

  // A URL typed without a scheme gets one, visibly, before it is sent.
  if (impliedScheme(findTab(tabId)!.request.url)) {
    updateRequest(tabId, (r) => ({ ...r, url: withDefaultScheme(r.url) }));
  }
  const request = findTab(tabId)!.request;
  const { request: resolved, warnings, error } = resolveRequest(request, activeVariables());
  const previous = getState().runs[tabId]?.response;

  if (error) {
    setRun(tabId, { state: 'error', error: { title: 'This request can’t be sent yet', detail: error }, warnings, response: previous });
    return;
  }

  const controller = new AbortController();
  controllers.set(tabId, controller);
  const startedAt = Date.now();
  setRun(tabId, { state: 'sending', startedAt, warnings, response: previous });
  const t0 = performance.now();

  try {
    const body = await encodeBody(resolved.body);
    const res = await fetch(resolved.url, {
      method: resolved.method,
      headers: resolved.headers,
      body,
      signal: controller.signal,
      // Never attach the browser's cookies for that site unless the user asks.
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
    });
    const ttfb = performance.now() - t0;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const time = performance.now() - t0;

    const headers: Array<[string, string]> = [];
    res.headers.forEach((value, name) => headers.push([name, value]));
    const contentType = res.headers.get('content-type') || '';
    const kind = classifyBody(contentType, bytes);
    const text = isTextualKind(kind) ? decodeText(bytes, parseContentType(contentType).charset) : undefined;

    const response: ResponseData = {
      status: res.status,
      statusText: res.statusText,
      headers,
      url: res.url || resolved.url,
      redirected: res.redirected,
      contentType,
      kind,
      bytes,
      text,
      size: bytes.byteLength,
      time,
      ttfb,
      receivedAt: Date.now(),
      method: resolved.method,
      requestUrl: resolved.url,
    };
    if (findTab(tabId)) {
      setRun(tabId, { state: 'done', response, warnings });
      if (bytes.byteLength <= MAX_STORED_RESPONSE) idbPut('responses', tabId, response).catch(() => undefined);
    }
    recordHistory(request, toHistoryResponse({ ...response }), startedAt);
  } catch (err) {
    const cancelled = controller.signal.aborted;
    let failure: FetchFailure;
    if (err instanceof MissingFileError) {
      failure = { title: 'A file needs to be chosen again', detail: `The contents of "${err.fileName}" are no longer stored. Choose the file again on the Body tab.` };
    } else if (err instanceof TypeError && /header/i.test(err.message)) {
      failure = { title: 'A header can’t be sent', detail: `${err.message}. Header values must be single-line Latin-1 text.` };
    } else {
      failure = describeFetchError(err, { cancelled, url: resolved.url });
    }
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
