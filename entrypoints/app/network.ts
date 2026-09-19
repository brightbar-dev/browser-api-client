/**
 * Watch this tab's own requests through webRequest. fetch() hides redirect hops,
 * Set-Cookie headers and the cause of a network failure; the browser reports all three
 * to extensions. Nothing outside the app's own tab is observed.
 */

import { browser } from 'wxt/browser';

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface NetworkTrace {
  hops: RedirectHop[];
  /** Raw Set-Cookie values with the URL that sent them; undefined when the browser's requests cannot be observed. */
  cookies?: Array<{ url: string; header: string }>;
  errorCode?: string;
}

interface Pending extends NetworkTrace {
  cookies: Array<{ url: string; header: string }>;
  method: string;
  url: string;
  requestId?: string;
  settled: boolean;
  waiters: Array<() => void>;
}

type Header = { name: string; value?: string };
type Details = { requestId: string; url: string; method?: string; statusCode?: number; redirectUrl?: string; responseHeaders?: Header[]; error?: string };

const pending: Pending[] = [];
let started: Promise<boolean> | null = null;

function byRequest(id: string): Pending | undefined {
  return pending.find((p) => p.requestId === id);
}

function settle(p: Pending) {
  p.settled = true;
  for (const w of p.waiters.splice(0)) w();
}

function cookiesFrom(url: string, headers: Header[] | undefined): Array<{ url: string; header: string }> {
  return (headers ?? [])
    .filter((h) => h.name.toLowerCase() === 'set-cookie' && h.value)
    .flatMap((h) => h.value!.split('\n'))
    .filter(Boolean)
    .map((header) => ({ url, header }));
}

/** Start observing. Resolves false where webRequest is unavailable. */
export function startNetworkObserver(): Promise<boolean> {
  started ??= (async () => {
    const wr = (browser as unknown as { webRequest?: Record<string, any> }).webRequest;
    if (!wr?.onBeforeRequest) return false;
    const tab = await browser.tabs.getCurrent();
    if (tab?.id === undefined) return false;
    const filter = { urls: ['<all_urls>'], tabId: tab.id };
    const extra = wr.OnHeadersReceivedOptions?.EXTRA_HEADERS ? ['responseHeaders', 'extraHeaders'] : ['responseHeaders'];
    const redirectExtra = wr.OnBeforeRedirectOptions?.EXTRA_HEADERS ? ['responseHeaders', 'extraHeaders'] : ['responseHeaders'];
    try {
      wr.onBeforeRequest.addListener((d: Details) => {
        const p = pending.find((x) => !x.requestId && x.url === d.url && x.method === (d.method ?? 'GET'));
        if (p) p.requestId = d.requestId;
      }, filter);
      wr.onBeforeRedirect.addListener((d: Details) => {
        const p = byRequest(d.requestId);
        if (!p) return;
        p.hops.push({ url: d.url, status: d.statusCode ?? 0, location: d.redirectUrl ?? '' });
        p.cookies.push(...cookiesFrom(d.url, d.responseHeaders));
      }, filter, redirectExtra);
      wr.onHeadersReceived.addListener((d: Details) => {
        const p = byRequest(d.requestId);
        // Redirect responses are recorded by onBeforeRedirect.
        if (p && !(d.statusCode && d.statusCode >= 300 && d.statusCode < 400)) p.cookies.push(...cookiesFrom(d.url, d.responseHeaders));
      }, filter, extra);
      wr.onCompleted.addListener((d: Details) => {
        const p = byRequest(d.requestId);
        if (p) settle(p);
      }, filter);
      wr.onErrorOccurred.addListener((d: Details) => {
        const p = byRequest(d.requestId);
        if (!p) return;
        p.errorCode = d.error;
        settle(p);
      }, filter);
    } catch (e) {
      console.warn('Network details are unavailable:', e);
      return false;
    }
    return true;
  })().catch(() => false);
  return started;
}

export function beginTrace(method: string, url: string): Pending {
  const p: Pending = { method, url, hops: [], cookies: [], settled: false, waiters: [] };
  pending.push(p);
  return p;
}

/** Wait briefly for the browser's final event, then stop tracking. */
export async function endTrace(p: Pending, waitMs = 250): Promise<NetworkTrace> {
  const observed = (await started) === true;
  if (!p.settled && observed) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, waitMs);
      p.waiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  const i = pending.indexOf(p);
  if (i !== -1) pending.splice(i, 1);
  // No observer means no Set-Cookie was seen, not that none was sent.
  return { hops: p.hops, cookies: observed ? p.cookies : undefined, errorCode: p.errorCode };
}
