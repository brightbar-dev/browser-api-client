import type { BodyKind, FetchFailure } from '@/utils/response';

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
}

export interface TabRun {
  state: 'idle' | 'sending' | 'done' | 'error';
  response?: ResponseData;
  error?: FetchFailure;
  startedAt?: number;
  warnings: string[];
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
