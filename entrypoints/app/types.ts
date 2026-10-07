import type { BodyKind, FetchFailure } from '@/utils/response';
import type { AssertionResult, ExtractionResult } from '@/utils/assertions';
import type { SseEvent } from '@/utils/sse';
import type { WsLogEntry } from '@/utils/websocket';
import type { RedirectHop } from './network';

/** A response as the app holds it: full bytes, decoded text when textual. */
export interface ResponseData {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  /** The URL that finally answered (after redirects). */
  url: string;
  redirected: boolean;
  contentType: string;
  kind: BodyKind;
  bytes: Uint8Array;
  text?: string;
  size: number;
  /** Total milliseconds, send to last byte. */
  time: number;
  /** Milliseconds until response headers arrived. */
  ttfb: number;
  receivedAt: number;
  method: string;
  requestUrl: string;
  /** Server-Sent Events, when the response was text/event-stream. */
  events?: SseEvent[];
  /** The user stopped the event stream before the server ended it. */
  streamStopped?: boolean;
  /** Redirect hops the browser followed, from webRequest. */
  redirects?: RedirectHop[];
  /** Set-Cookie headers from webRequest (fetch hides them); undefined when not observable. */
  cookies?: Array<{ url: string; header: string }>;
}

export type TestResult = AssertionResult & { label: string };

export interface TabRun {
  state: 'idle' | 'sending' | 'streaming' | 'done' | 'error';
  response?: ResponseData;
  error?: FetchFailure;
  startedAt?: number;
  warnings: string[];
  tests?: TestResult[];
  extracted?: ExtractionResult[];
  /** Where extracted values went, or why they didn't. */
  extractNote?: string;
}

export type SidebarPanel = 'history' | 'collections' | 'environments';

export interface Layout {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarPanel: SidebarPanel;
  /** Share of the work area's height given to the request editor. */
  requestFraction: number;
}

export const DEFAULT_LAYOUT: Layout = {
  sidebarOpen: true,
  sidebarWidth: 280,
  sidebarPanel: 'history',
  requestFraction: 0.45,
};

/** One WebSocket connection's state and message log, kept in memory (never in storage). */
export interface WsSession {
  state: 'connecting' | 'open' | 'closing' | 'closed';
  /** The URL actually connected to, after variables and scheme. */
  url: string;
  /** Subprotocol the server chose, if any. */
  protocol: string;
  log: WsLogEntry[];
  /** Log entries dropped from the front once the log was full. */
  dropped: number;
  sent: number;
  received: number;
  startedAt: number;
  openedAt?: number;
  /** Why it never connected, when the request could not be set up (bad URL, bad subprotocol). */
  error?: string;
  closeCode?: number;
}
