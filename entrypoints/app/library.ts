/**
 * Collections and environments: state updates apply at once, storage writes follow
 * (debounced for per-keystroke edits such as variable values).
 */

import { browser } from 'wxt/browser';
import type { ApiRequest } from '@/utils/request';
import { generateId } from '@/utils/request';
import type { Collection } from '@/utils/collections';
import * as col from '@/utils/collections';
import type { Environment } from '@/utils/environment';
import { duplicateEnvironment, newEnvironment } from '@/utils/environment';
import { markTabSaved, updateTabRequest } from '@/utils/workspace';
import { findTab, getState, openDialog, openRequest, setActiveEnv, setState, showToast, updateWorkspace } from './store';

let collectionsTimer: ReturnType<typeof setTimeout> | undefined;
let environmentsTimer: ReturnType<typeof setTimeout> | undefined;

export function commitCollections(collections: Collection[], debounce = false): void {
  setState((s) => ({ ...s, collections }));
  clearTimeout(collectionsTimer);
  const write = () => void browser.storage.local.set({ collections: getState().collections });
  if (debounce) collectionsTimer = setTimeout(write, 300);
  else write();
}

export function commitEnvironments(environments: Environment[], debounce = false): void {
  setState((s) => ({ ...s, environments }));
  clearTimeout(environmentsTimer);
  const write = () => void browser.storage.local.set({ environments: getState().environments });
  if (debounce) environmentsTimer = setTimeout(write, 300);
  else write();
}

// --- collections ---

export function updateCollection(id: string, fn: (c: Collection) => Collection, debounce = false): void {
  commitCollections(
    getState().collections.map((c) => (c.id === id ? fn(c) : c)),
    debounce,
  );
}

export function createCollection(name = 'New collection'): Collection {
  const c = col.newCollection(name);
  c.folders = [];
  commitCollections([...getState().collections, c]);
  return c;
}

export function deleteCollection(id: string): void {
  commitCollections(getState().collections.filter((c) => c.id !== id));
}

export function duplicateCollection(id: string): void {
  const list = getState().collections;
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const copy = col.duplicateCollection(list[idx]!);
  commitCollections([...list.slice(0, idx + 1), copy, ...list.slice(idx + 1)]);
}

export function moveCollection(id: string, newIndex: number): void {
  const list = [...getState().collections];
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const [moved] = list.splice(idx, 1);
  list.splice(Math.max(0, Math.min(list.length, newIndex)), 0, moved!);
  commitCollections(list);
}

export function collectionExists(id: string): boolean {
  return getState().collections.some((c) => c.id === id);
}

/** Save an open tab into a collection (new request, or an update if it came from there). */
export function saveTabToCollection(tabId: string, target: { collectionId: string; folderId: string | null; name: string }): void {
  const tab = findTab(tabId);
  if (!tab) return;
  const requestId = tab.source?.collectionId === target.collectionId && tab.source.requestId ? tab.source.requestId : generateId();
  const request: ApiRequest = { ...JSON.parse(JSON.stringify(tab.request)), id: requestId, name: target.name };
  updateCollection(target.collectionId, (c) => {
    const existing = col.findRequestLocation([c], requestId);
    return col.upsertRequest(c, request, existing ? existing.folderId : target.folderId);
  });
  updateWorkspace((w) =>
    markTabSaved(updateTabRequest(w, tabId, { ...tab.request, id: requestId, name: target.name }), tabId, {
      collectionId: target.collectionId,
      requestId,
    }),
  );
}

/** Save a tab back where it came from. Returns false when it has no saved home. */
export function saveTabInPlace(tabId: string): boolean {
  const tab = findTab(tabId);
  if (!tab?.source) return false;
  const collection = getState().collections.find((c) => c.id === tab.source!.collectionId);
  if (!collection) return false;
  const location = col.findRequestLocation([collection], tab.source.requestId);
  saveTabToCollection(tabId, { collectionId: collection.id, folderId: location?.folderId ?? null, name: tab.request.name });
  return true;
}

export function openFromCollection(collectionId: string, requestId: string): void {
  const collection = getState().collections.find((c) => c.id === collectionId);
  const request = collection && col.findRequestAnywhere(collection, requestId);
  if (request) openRequest(request, { collectionId, requestId });
}

// --- environments ---

export function updateEnvironment(id: string, fn: (e: Environment) => Environment, debounce = false): void {
  commitEnvironments(
    getState().environments.map((e) => (e.id === id ? fn(e) : e)),
    debounce,
  );
}

export function createEnvironment(name = 'New environment'): Environment {
  const env = newEnvironment(name);
  env.variables = [];
  commitEnvironments([...getState().environments, env]);
  return env;
}

export function deleteEnvironment(id: string): void {
  if (getState().activeEnvId === id) setActiveEnv(null);
  commitEnvironments(getState().environments.filter((e) => e.id !== id));
}

export function duplicateEnvironmentById(id: string): void {
  const list = getState().environments;
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return;
  commitEnvironments([...list.slice(0, idx + 1), duplicateEnvironment(list[idx]!), ...list.slice(idx + 1)]);
}

/** Cmd/Ctrl+S: save in place when the tab has a home, otherwise ask where. */
export function requestSave(tabId: string): void {
  if (saveTabInPlace(tabId)) showToast('Saved');
  else openDialog({ type: 'save', tabId });
}

/** Move a request within or between collections. */
export function moveRequestAcross(fromCollectionId: string, requestId: string, toCollectionId: string, target: { folderId: string | null; index: number }): void {
  const collections = getState().collections;
  const from = collections.find((c) => c.id === fromCollectionId);
  const request = from && col.findRequestAnywhere(from, requestId);
  if (!from || !request) return;
  if (fromCollectionId === toCollectionId) {
    updateCollection(fromCollectionId, (c) => col.moveRequestTo(c, requestId, target));
    return;
  }
  commitCollections(
    collections.map((c) => {
      if (c.id === fromCollectionId) return col.removeRequestAnywhere(c, requestId);
      if (c.id === toCollectionId) return col.moveRequestTo(col.upsertRequest(c, request, target.folderId), requestId, target);
      return c;
    }),
  );
  updateWorkspace((w) => ({
    ...w,
    tabs: w.tabs.map((t) => (t.source?.requestId === requestId ? { ...t, source: { collectionId: toCollectionId, requestId } } : t)),
  }));
}
