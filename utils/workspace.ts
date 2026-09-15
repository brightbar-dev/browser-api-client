/**
 * The app's open request tabs. The whole workspace is persisted as a draft on every
 * edit, so a reload, a crash or closing the tab never loses what was typed.
 */

import type { ApiRequest } from './request';
import { newRequest, generateId } from './request';
import { sanitizeRequest } from './sanitize';

export interface WorkspaceTab {
  id: string;
  request: ApiRequest;
  /** Where the request was opened from, if it is saved in a collection. */
  source?: { collectionId: string; requestId: string };
  /** Signature of the request when it was last opened or saved; unset for scratch tabs. */
  baseline?: string;
}

export interface Workspace {
  version: 1;
  tabs: WorkspaceTab[];
  activeTabId: string;
}

export const MAX_TABS = 30;

export function newTab(request: ApiRequest = newRequest()): WorkspaceTab {
  return { id: generateId(), request };
}

export function newWorkspace(): Workspace {
  const tab = newTab();
  return { version: 1, tabs: [tab], activeTabId: tab.id };
}

/** Everything that makes two requests "the same" for unsaved-change purposes. */
export function requestSignature(req: ApiRequest): string {
  const { id: _id, ...rest } = req;
  return stableStringify(rest);
}

/** JSON with object keys sorted and undefined members dropped, so field order never matters. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter(k => obj[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function isBlankRequest(req: ApiRequest): boolean {
  return (
    req.url.trim() === '' &&
    req.headers.every(h => !h.key && !h.value) &&
    req.params.every(p => !p.key && !p.value) &&
    req.body.trim() === '' &&
    (req.formFields || []).every(f => !f.key && !f.value) &&
    (req.multipartFields || []).every(f => !f.key && !f.value && !f.file) &&
    !req.binaryFile &&
    req.auth.type === 'none'
  );
}

/** Saved tabs are dirty when they differ from their baseline; scratch tabs when they hold anything. */
export function isTabDirty(tab: WorkspaceTab): boolean {
  if (tab.baseline !== undefined) return requestSignature(tab.request) !== tab.baseline;
  return !isBlankRequest(tab.request);
}

export function activeTab(ws: Workspace): WorkspaceTab {
  return ws.tabs.find(t => t.id === ws.activeTabId) ?? ws.tabs[0]!;
}

/** A short label: the saved name, else `host/path`, else "Untitled request". */
export function tabTitle(tab: WorkspaceTab): string {
  const { request } = tab;
  if (tab.source || (request.name && request.name !== 'New Request')) return request.name || 'Untitled request';
  const url = request.url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[?#]/)[0] ?? '';
  return url || 'Untitled request';
}

export function addTab(ws: Workspace, tab: WorkspaceTab = newTab()): Workspace {
  let tabs = [...ws.tabs, tab];
  // Past the cap, drop the oldest clean tab so the strip stays usable.
  if (tabs.length > MAX_TABS) {
    const idx = tabs.findIndex(t => t.id !== tab.id && !isTabDirty(t));
    if (idx !== -1) tabs = tabs.filter((_, i) => i !== idx);
  }
  return { ...ws, tabs, activeTabId: tab.id };
}

/** Open a request in a tab, focusing the existing tab if that saved request is already open. */
export function openRequest(ws: Workspace, request: ApiRequest, source?: WorkspaceTab['source']): Workspace {
  if (source) {
    const existing = ws.tabs.find(t => t.source?.collectionId === source.collectionId && t.source.requestId === source.requestId);
    if (existing) return { ...ws, activeTabId: existing.id };
  }
  const active = activeTab(ws);
  const copy: ApiRequest = structuredCloneRequest(request);
  const tab: WorkspaceTab = source
    ? { id: generateId(), request: copy, source, baseline: requestSignature(copy) }
    : { id: generateId(), request: copy };
  // Reuse an untouched scratch tab instead of piling up empty ones.
  if (!active.source && isBlankRequest(active.request)) {
    return { ...ws, tabs: ws.tabs.map(t => (t.id === active.id ? tab : t)), activeTabId: tab.id };
  }
  return addTab(ws, tab);
}

function structuredCloneRequest(req: ApiRequest): ApiRequest {
  return JSON.parse(JSON.stringify(req)) as ApiRequest;
}

export function closeTab(ws: Workspace, tabId: string): Workspace {
  const idx = ws.tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return ws;
  const tabs = ws.tabs.filter(t => t.id !== tabId);
  if (tabs.length === 0) {
    const tab = newTab();
    return { ...ws, tabs: [tab], activeTabId: tab.id };
  }
  const activeTabId = ws.activeTabId === tabId ? tabs[Math.min(idx, tabs.length - 1)]!.id : ws.activeTabId;
  return { ...ws, tabs, activeTabId };
}

export function activateTab(ws: Workspace, tabId: string): Workspace {
  return ws.tabs.some(t => t.id === tabId) ? { ...ws, activeTabId: tabId } : ws;
}

export function updateTabRequest(ws: Workspace, tabId: string, request: ApiRequest): Workspace {
  return { ...ws, tabs: ws.tabs.map(t => (t.id === tabId ? { ...t, request } : t)) };
}

export function markTabSaved(ws: Workspace, tabId: string, source: NonNullable<WorkspaceTab['source']>): Workspace {
  return {
    ...ws,
    tabs: ws.tabs.map(t => (t.id === tabId ? { ...t, source, baseline: requestSignature(t.request) } : t)),
  };
}

export function moveTab(ws: Workspace, from: number, to: number): Workspace {
  if (from === to || from < 0 || to < 0 || from >= ws.tabs.length || to >= ws.tabs.length) return ws;
  const tabs = [...ws.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved!);
  return { ...ws, tabs };
}

/** Rebuild a workspace from storage, dropping anything malformed. Never throws. */
export function restoreWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') return newWorkspace();
  const obj = raw as Record<string, unknown>;
  const tabs: WorkspaceTab[] = [];
  const seen = new Set<string>();
  if (Array.isArray(obj.tabs)) {
    for (const t of obj.tabs.slice(0, MAX_TABS)) {
      if (!t || typeof t !== 'object') continue;
      const tr = t as Record<string, unknown>;
      const request = sanitizeRequest(tr.request);
      if (!request) continue;
      const id = typeof tr.id === 'string' && tr.id && !seen.has(tr.id) ? tr.id : generateId();
      seen.add(id);
      const tab: WorkspaceTab = { id, request };
      const src = tr.source as Record<string, unknown> | undefined;
      if (src && typeof src.collectionId === 'string' && typeof src.requestId === 'string') {
        tab.source = { collectionId: src.collectionId, requestId: src.requestId };
      }
      if (typeof tr.baseline === 'string') tab.baseline = tr.baseline;
      tabs.push(tab);
    }
  }
  if (tabs.length === 0) return newWorkspace();
  const activeTabId = typeof obj.activeTabId === 'string' && tabs.some(t => t.id === obj.activeTabId) ? obj.activeTabId : tabs[0]!.id;
  return { version: 1, tabs, activeTabId };
}
