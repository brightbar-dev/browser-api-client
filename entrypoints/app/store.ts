/**
 * App state: one module-level store, components subscribe to slices with useApp().
 * The workspace (every open tab's request) is written to storage.local shortly after
 * each edit and flushed when the page hides, so drafts survive reloads and crashes.
 */

import { useEffect, useReducer, useRef } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { ApiRequest } from '@/utils/request';
import type { Environment, EnvVariable } from '@/utils/environment';
import type { Collection } from '@/utils/collections';
import type { HistoryEntry } from '@/utils/history';
import type { Workspace, WorkspaceTab } from '@/utils/workspace';
import * as wsOps from '@/utils/workspace';
import { sanitizeCollection, sanitizeEnvironment, sanitizeHistoryEntry, sanitizeList } from '@/utils/sanitize';
import { clampMaxHistory, type Theme } from '@/utils/backup';
import { idbDelete, idbGet } from '@/utils/idb';
import { DEFAULT_LAYOUT, type Layout, type ResponseData, type TabRun } from './types';
import { startNetworkObserver } from './network';

export type DialogState =
  | null
  | { type: 'save'; tabId: string }
  | { type: 'environment'; envId: string }
  | { type: 'import' }
  | { type: 'code'; tabId: string }
  | { type: 'runner'; collectionId: string; folderId: string | null }
  | { type: 'shortcuts' };

export interface AppState {
  ready: boolean;
  dialog: DialogState;
  toast: { id: number; message: string } | null;
  version: string;
  workspace: Workspace;
  runs: Record<string, TabRun>;
  environments: Environment[];
  activeEnvId: string | null;
  collections: Collection[];
  history: HistoryEntry[];
  theme: Theme;
  maxHistory: number;
  /** Seconds before a request is abandoned; 0 means no limit. */
  requestTimeout: number;
  /** False only on a first run, until the first send. */
  welcomed: boolean;
  layout: Layout;
}

let state: AppState = {
  ready: false,
  dialog: null,
  toast: null,
  version: '',
  workspace: wsOps.newWorkspace(),
  runs: {},
  environments: [],
  activeEnvId: null,
  collections: [],
  history: [],
  theme: 'auto',
  maxHistory: 100,
  requestTimeout: 0,
  welcomed: true,
  layout: DEFAULT_LAYOUT,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(fn: (s: AppState) => AppState): void {
  const next = fn(state);
  if (next === state) return;
  state = next;
  for (const l of [...listeners]) l();
}

/** Subscribe to a slice of state; re-renders only when that slice changes identity. */
export function useApp<S>(selector: (s: AppState) => S): S {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const value = selector(state);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    const listener = () => {
      const next = selectorRef.current(state);
      if (!Object.is(next, valueRef.current)) force(0);
    };
    listeners.add(listener);
    // State may have changed between render and this subscription.
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}

// --- persistence ---

let workspaceTimer: ReturnType<typeof setTimeout> | undefined;
let layoutTimer: ReturnType<typeof setTimeout> | undefined;

export function flushWorkspace(): void {
  clearTimeout(workspaceTimer);
  workspaceTimer = undefined;
  if (state.ready) void browser.storage.local.set({ workspace: state.workspace });
}

function persistWorkspaceSoon() {
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(flushWorkspace, 250);
}

function persistLayoutSoon() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => void browser.storage.local.set({ layout: state.layout }), 300);
}

function sanitizeLayout(raw: unknown): Layout {
  const l = (raw && typeof raw === 'object' ? raw : {}) as Partial<Layout>;
  return {
    sidebarOpen: typeof l.sidebarOpen === 'boolean' ? l.sidebarOpen : DEFAULT_LAYOUT.sidebarOpen,
    sidebarWidth: typeof l.sidebarWidth === 'number' ? Math.min(520, Math.max(200, l.sidebarWidth)) : DEFAULT_LAYOUT.sidebarWidth,
    sidebarPanel: l.sidebarPanel === 'collections' || l.sidebarPanel === 'environments' ? l.sidebarPanel : 'history',
    requestFraction: typeof l.requestFraction === 'number' ? Math.min(0.85, Math.max(0.15, l.requestFraction)) : DEFAULT_LAYOUT.requestFraction,
  };
}

function readTheme(v: unknown): Theme {
  return v === 'light' || v === 'dark' ? v : 'auto';
}

function readTimeout(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(600, Math.round(n))) : 0;
}

/** The first-run tab: a real request the user can send, which nothing sends for them. */
function sampleWorkspace(): Workspace {
  const ws = wsOps.newWorkspace();
  const tab = ws.tabs[0]!;
  tab.request = {
    ...tab.request,
    name: 'Try it: GET with a query parameter',
    url: 'https://httpbin.org/get?hello=world',
    params: [{ key: 'hello', value: 'world', enabled: true }],
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  };
  return ws;
}

export async function loadApp(): Promise<void> {
  const stored = await browser.storage.local.get([
    'workspace', 'environments', 'activeEnvId', 'collections', 'history', 'theme', 'maxHistory', 'layout', 'requestTimeout', 'welcomed',
  ]);
  const firstRun = stored.workspace === undefined && stored.welcomed !== true;
  const workspace = firstRun ? sampleWorkspace() : wsOps.restoreWorkspace(stored.workspace);
  void startNetworkObserver();
  setState((s) => ({
    ...s,
    ready: true,
    version: browser.runtime.getManifest().version,
    workspace,
    environments: sanitizeList(stored.environments, sanitizeEnvironment).items,
    activeEnvId: typeof stored.activeEnvId === 'string' ? stored.activeEnvId : null,
    collections: sanitizeList(stored.collections, sanitizeCollection).items,
    history: sanitizeList(stored.history, sanitizeHistoryEntry).items,
    theme: readTheme(stored.theme),
    maxHistory: clampMaxHistory(stored.maxHistory ?? 100),
    requestTimeout: readTimeout(stored.requestTimeout),
    welcomed: !firstRun,
    layout: sanitizeLayout(stored.layout),
  }));

  // Bring back each tab's last response.
  for (const tab of workspace.tabs) {
    idbGet<ResponseData>('responses', tab.id)
      .then((response) => {
        if (response && !getState().runs[tab.id]) setRun(tab.id, { state: 'done', response, warnings: [] });
      })
      .catch(() => undefined);
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    setState((s) => {
      let next = s;
      if (changes.history) next = { ...next, history: sanitizeList(changes.history.newValue, sanitizeHistoryEntry).items };
      if (changes.collections) next = { ...next, collections: sanitizeList(changes.collections.newValue, sanitizeCollection).items };
      if (changes.environments) next = { ...next, environments: sanitizeList(changes.environments.newValue, sanitizeEnvironment).items };
      if (changes.activeEnvId) next = { ...next, activeEnvId: typeof changes.activeEnvId.newValue === 'string' ? changes.activeEnvId.newValue : null };
      if (changes.theme) next = { ...next, theme: readTheme(changes.theme.newValue) };
      if (changes.maxHistory) next = { ...next, maxHistory: clampMaxHistory(changes.maxHistory.newValue ?? 100) };
      if (changes.requestTimeout) next = { ...next, requestTimeout: readTimeout(changes.requestTimeout.newValue) };
      return next;
    });
  });

  window.addEventListener('pagehide', flushWorkspace);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushWorkspace();
  });
}

// --- workspace actions ---

export function updateWorkspace(fn: (w: Workspace) => Workspace): void {
  let changed = false;
  setState((s) => {
    const w = fn(s.workspace);
    if (w === s.workspace) return s;
    changed = true;
    return { ...s, workspace: w };
  });
  if (changed) persistWorkspaceSoon();
}

export function findTab(tabId: string): WorkspaceTab | undefined {
  return state.workspace.tabs.find((t) => t.id === tabId);
}

export function updateRequest(tabId: string, fn: (r: ApiRequest) => ApiRequest): void {
  updateWorkspace((w) => {
    const tab = w.tabs.find((t) => t.id === tabId);
    return tab ? wsOps.updateTabRequest(w, tabId, fn(tab.request)) : w;
  });
}

export function newTab(): void {
  updateWorkspace((w) => wsOps.addTab(w));
}

export function activateTab(tabId: string): void {
  updateWorkspace((w) => wsOps.activateTab(w, tabId));
}

export function openRequest(request: ApiRequest, source?: WorkspaceTab['source']): void {
  updateWorkspace((w) => wsOps.openRequest(w, request, source));
}

export function moveTab(from: number, to: number): void {
  updateWorkspace((w) => wsOps.moveTab(w, from, to));
}

export function closeTab(tabId: string, onClose?: (tabId: string) => void): void {
  onClose?.(tabId);
  setState((s) => {
    if (!(tabId in s.runs)) return s;
    const runs = { ...s.runs };
    delete runs[tabId];
    return { ...s, runs };
  });
  idbDelete('responses', tabId).catch(() => undefined);
  updateWorkspace((w) => wsOps.closeTab(w, tabId));
}

export function setRun(tabId: string, run: TabRun): void {
  setState((s) => ({ ...s, runs: { ...s.runs, [tabId]: run } }));
}

// --- other state ---

export function setLayout(partial: Partial<Layout>): void {
  setState((s) => ({ ...s, layout: { ...s.layout, ...partial } }));
  persistLayoutSoon();
}

export function setActiveEnv(envId: string | null): void {
  setState((s) => ({ ...s, activeEnvId: envId }));
  void browser.storage.local.set({ activeEnvId: envId });
}

export function activeVariables(s: AppState = state): EnvVariable[] {
  const env = s.environments.find((e) => e.id === s.activeEnvId);
  return env ? env.variables.filter((v) => v.enabled && v.key) : [];
}

export async function clearHistory(): Promise<void> {
  await browser.runtime.sendMessage({ action: 'clearHistory' });
}

export async function deleteHistory(ids: string[]): Promise<void> {
  await browser.runtime.sendMessage({ action: 'deleteHistory', ids });
}

// --- dialogs and toasts ---

export function openDialog(dialog: DialogState): void {
  setState((s) => ({ ...s, dialog }));
}

export function closeDialog(): void {
  setState((s) => (s.dialog ? { ...s, dialog: null } : s));
}

let toastSeq = 0;
export function showToast(message: string): void {
  const id = ++toastSeq;
  setState((s) => ({ ...s, toast: { id, message } }));
  setTimeout(() => setState((s) => (s.toast?.id === id ? { ...s, toast: null } : s)), 4000);
}

export function markWelcomed(): void {
  if (state.welcomed) return;
  setState((s) => ({ ...s, welcomed: true }));
  void browser.storage.local.set({ welcomed: true });
}
