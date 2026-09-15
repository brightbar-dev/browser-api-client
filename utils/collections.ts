/**
 * Request collections — named groups of saved API requests, optionally sorted into
 * folders (one level deep).
 *
 * Every operation that changes a collection returns a new object with `updated` bumped and
 * never mutates its input. An operation whose target (folder or request id) does not exist
 * returns the input collection unchanged — the same object.
 */

import type { ApiRequest } from './request';
import { generateId } from './request';

/** A folder inside a collection. Folders are one level deep. */
export interface CollectionFolder {
  id: string;
  name: string;
  requests: ApiRequest[];
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  /** Requests at the collection root. */
  requests: ApiRequest[];
  folders?: CollectionFolder[];
  created: number;
  updated: number;
}

/** Where a request lives. `folderId` is null for the collection root. */
export interface RequestLocation {
  collectionId: string;
  folderId: string | null;
  index: number;
}

/** Create a new empty collection. */
export function newCollection(name = 'New Collection'): Collection {
  const now = Date.now();
  return {
    id: generateId(),
    name,
    description: '',
    requests: [],
    created: now,
    updated: now,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A deep copy of a request with a fresh id. Requests are plain JSON. */
function copyRequest(request: ApiRequest, name = request.name): ApiRequest {
  const copy = JSON.parse(JSON.stringify(request)) as ApiRequest;
  return { ...copy, id: generateId(), name };
}

/** Clamp an insertion index to 0..length. NaN appends. */
function clampIndex(index: number, length: number): number {
  if (Number.isNaN(index)) return length;
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

/** Replace the request list of the root (`folderId` null) or of one folder. */
function updateList(c: Collection, folderId: string | null, fn: (requests: ApiRequest[]) => ApiRequest[]): Collection {
  if (folderId === null) return { ...c, requests: fn(c.requests), updated: Date.now() };
  return {
    ...c,
    folders: (c.folders ?? []).map(f => (f.id === folderId ? { ...f, requests: fn(f.requests) } : f)),
    updated: Date.now(),
  };
}

function hasFolder(c: Collection, folderId: string): boolean {
  return (c.folders ?? []).some(f => f.id === folderId);
}

// ---------------------------------------------------------------------------
// Root-only request operations (kept for existing callers)
// ---------------------------------------------------------------------------

/** Add a request to a collection (returns new collection). */
export function addRequest(collection: Collection, request: ApiRequest): Collection {
  return {
    ...collection,
    requests: [...collection.requests, request],
    updated: Date.now(),
  };
}

/** Remove a request from a collection's root by ID. */
export function removeRequest(collection: Collection, requestId: string): Collection {
  return {
    ...collection,
    requests: collection.requests.filter(r => r.id !== requestId),
    updated: Date.now(),
  };
}

/** Update a request within a collection's root. */
export function updateRequest(collection: Collection, updated: ApiRequest): Collection {
  return {
    ...collection,
    requests: collection.requests.map(r => r.id === updated.id ? updated : r),
    updated: Date.now(),
  };
}

/** Move a request within a collection's root (reorder). */
export function moveRequest(collection: Collection, requestId: string, newIndex: number): Collection {
  const requests = [...collection.requests];
  const oldIndex = requests.findIndex(r => r.id === requestId);
  if (oldIndex === -1) return collection;
  if (newIndex < 0 || newIndex >= requests.length) return collection;

  const [moved] = requests.splice(oldIndex, 1);
  requests.splice(newIndex, 0, moved!);

  return {
    ...collection,
    requests,
    updated: Date.now(),
  };
}

/** Find a request in a collection's root by ID. */
export function findRequest(collection: Collection, requestId: string): ApiRequest | undefined {
  return collection.requests.find(r => r.id === requestId);
}

// ---------------------------------------------------------------------------
// Lookup across root and folders
// ---------------------------------------------------------------------------

/** Find where a request lives across collections: root first, then each folder in order. */
export function findRequestLocation(collections: Collection[], requestId: string): RequestLocation | null {
  for (const c of collections) {
    const index = c.requests.findIndex(r => r.id === requestId);
    if (index !== -1) return { collectionId: c.id, folderId: null, index };
    for (const f of c.folders ?? []) {
      const i = f.requests.findIndex(r => r.id === requestId);
      if (i !== -1) return { collectionId: c.id, folderId: f.id, index: i };
    }
  }
  return null;
}

/** Find a request in a collection's root or any of its folders. */
export function findRequestAnywhere(c: Collection, requestId: string): ApiRequest | undefined {
  const root = c.requests.find(r => r.id === requestId);
  if (root) return root;
  for (const f of c.folders ?? []) {
    const found = f.requests.find(r => r.id === requestId);
    if (found) return found;
  }
  return undefined;
}

/** Every request in a collection: root requests first, then each folder's, in order. */
export function allRequests(c: Collection): Array<{ request: ApiRequest; folder: CollectionFolder | null }> {
  return [
    ...c.requests.map(request => ({ request, folder: null })),
    ...(c.folders ?? []).flatMap(folder => folder.requests.map(request => ({ request, folder }))),
  ];
}

/** Number of requests in a collection, folders included. */
export function countRequests(c: Collection): number {
  return (c.folders ?? []).reduce((sum, f) => sum + f.requests.length, c.requests.length);
}

// ---------------------------------------------------------------------------
// Collection and folder operations
// ---------------------------------------------------------------------------

export function renameCollection(c: Collection, name: string): Collection {
  return { ...c, name, updated: Date.now() };
}

/** Append an empty folder. */
export function addFolder(c: Collection, name = 'New folder'): { collection: Collection; folder: CollectionFolder } {
  const folder: CollectionFolder = { id: generateId(), name, requests: [] };
  return { collection: { ...c, folders: [...(c.folders ?? []), folder], updated: Date.now() }, folder };
}

export function renameFolder(c: Collection, folderId: string, name: string): Collection {
  if (!hasFolder(c, folderId)) return c;
  return { ...c, folders: c.folders!.map(f => (f.id === folderId ? { ...f, name } : f)), updated: Date.now() };
}

/** Remove a folder and the requests in it. */
export function deleteFolder(c: Collection, folderId: string): Collection {
  if (!hasFolder(c, folderId)) return c;
  return { ...c, folders: c.folders!.filter(f => f.id !== folderId), updated: Date.now() };
}

/** Insert a copy right after the folder, named "X copy", with fresh ids for it and its requests. */
export function duplicateFolder(c: Collection, folderId: string): Collection {
  const folders = c.folders ?? [];
  const i = folders.findIndex(f => f.id === folderId);
  if (i === -1) return c;
  const original = folders[i]!;
  const copy: CollectionFolder = {
    id: generateId(),
    name: `${original.name} copy`,
    requests: original.requests.map(r => copyRequest(r)),
  };
  return { ...c, folders: [...folders.slice(0, i + 1), copy, ...folders.slice(i + 1)], updated: Date.now() };
}

/** Move a folder to `newIndex`, clamped to the valid range. */
export function moveFolder(c: Collection, folderId: string, newIndex: number): Collection {
  const folders = [...(c.folders ?? [])];
  const from = folders.findIndex(f => f.id === folderId);
  if (from === -1) return c;
  const [folder] = folders.splice(from, 1);
  folders.splice(clampIndex(newIndex, folders.length), 0, folder!);
  return { ...c, folders, updated: Date.now() };
}

// ---------------------------------------------------------------------------
// Request operations across root and folders
// ---------------------------------------------------------------------------

/**
 * Save a request. If its id already exists anywhere in the collection it is replaced in
 * place; otherwise it is appended to `folderId` (or the root when `folderId` is null or
 * names no folder).
 */
export function upsertRequest(c: Collection, request: ApiRequest, folderId: string | null): Collection {
  const at = findRequestLocation([c], request.id);
  if (at) return updateList(c, at.folderId, list => list.map((r, i) => (i === at.index ? request : r)));
  const target = folderId !== null && hasFolder(c, folderId) ? folderId : null;
  return updateList(c, target, list => [...list, request]);
}

/** Remove a request from the root and every folder. */
export function removeRequestAnywhere(c: Collection, requestId: string): Collection {
  if (!findRequestLocation([c], requestId)) return c;
  const keep = (r: ApiRequest) => r.id !== requestId;
  const next: Collection = { ...c, requests: c.requests.filter(keep), updated: Date.now() };
  if (c.folders) next.folders = c.folders.map(f => ({ ...f, requests: f.requests.filter(keep) }));
  return next;
}

/** Insert a copy right after the request, named "X copy", with a fresh id. */
export function duplicateRequestAnywhere(c: Collection, requestId: string): { collection: Collection; request: ApiRequest | null } {
  const at = findRequestLocation([c], requestId);
  const original = findRequestAnywhere(c, requestId);
  if (!at || !original) return { collection: c, request: null };
  const copy = copyRequest(original, `${original.name} copy`);
  const collection = updateList(c, at.folderId, list => [...list.slice(0, at.index + 1), copy, ...list.slice(at.index + 1)]);
  return { collection, request: copy };
}

/**
 * Move a request to `target.folderId` (null = root) at `target.index`, clamped to the
 * destination's length after the request is removed from where it was. Unknown request
 * or destination folder: unchanged.
 */
export function moveRequestTo(c: Collection, requestId: string, target: { folderId: string | null; index: number }): Collection {
  const at = findRequestLocation([c], requestId);
  const request = findRequestAnywhere(c, requestId);
  if (!at || !request) return c;
  if (target.folderId !== null && !hasFolder(c, target.folderId)) return c;
  const removed = updateList(c, at.folderId, list => list.filter((_, i) => i !== at.index));
  return updateList(removed, target.folderId, list => {
    const i = clampIndex(target.index, list.length);
    return [...list.slice(0, i), request, ...list.slice(i)];
  });
}

// ---------------------------------------------------------------------------
// Lists of collections
// ---------------------------------------------------------------------------

/** Sort collections by last updated (most recent first). */
export function sortByUpdated(collections: Collection[]): Collection[] {
  return [...collections].sort((a, b) => b.updated - a.updated);
}

/** Sort collections alphabetically by name. */
export function sortByName(collections: Collection[]): Collection[] {
  return [...collections].sort((a, b) => a.name.localeCompare(b.name));
}

/** Search collections by name, description, folder name, or request name/URL. */
export function searchCollections(collections: Collection[], query: string): Collection[] {
  const q = query.toLowerCase();
  const matchesRequest = (r: ApiRequest) => r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q);
  return collections.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.description.toLowerCase().includes(q) ||
    c.requests.some(matchesRequest) ||
    (c.folders ?? []).some(f => f.name.toLowerCase().includes(q) || f.requests.some(matchesRequest))
  );
}

/**
 * Narrow a collection tree to a search query (case-insensitive). An empty query returns the
 * input. A collection whose name matches is kept whole, as is a folder whose name matches;
 * otherwise only requests whose name, URL or method match are kept, and folders and
 * collections left empty are dropped. `updated` is not changed.
 */
export function filterCollectionTree(collections: Collection[], query: string): Collection[] {
  const q = query.trim().toLowerCase();
  if (!q) return collections;
  const matchesRequest = (r: ApiRequest) =>
    r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q) || r.method.toLowerCase().includes(q);

  const out: Collection[] = [];
  for (const c of collections) {
    if (c.name.toLowerCase().includes(q)) {
      out.push(c);
      continue;
    }
    const requests = c.requests.filter(matchesRequest);
    const folders = (c.folders ?? []).flatMap((f): CollectionFolder[] => {
      if (f.name.toLowerCase().includes(q)) return [f];
      const kept = f.requests.filter(matchesRequest);
      return kept.length > 0 ? [{ ...f, requests: kept }] : [];
    });
    if (requests.length === 0 && folders.length === 0) continue;
    const filtered: Collection = { ...c, requests };
    if (c.folders) filtered.folders = folders;
    out.push(filtered);
  }
  return out;
}

/** Duplicate a collection with a new ID and name; folders and requests get fresh ids too. */
export function duplicateCollection(collection: Collection): Collection {
  const now = Date.now();
  const copy: Collection = {
    ...collection,
    id: generateId(),
    name: `${collection.name} (copy)`,
    requests: collection.requests.map(r => copyRequest(r)),
    created: now,
    updated: now,
  };
  if (collection.folders) {
    copy.folders = collection.folders.map(f => ({ id: generateId(), name: f.name, requests: f.requests.map(r => copyRequest(r)) }));
  }
  return copy;
}

/** Get total request count across multiple collections, folders included. */
export function totalRequests(collections: Collection[]): number {
  return collections.reduce((sum, c) => sum + countRequests(c), 0);
}
