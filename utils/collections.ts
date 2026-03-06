/** Request collections — named groups of saved API requests. */

import type { ApiRequest } from './request';
import { generateId } from './request';

export interface Collection {
  id: string;
  name: string;
  description: string;
  requests: ApiRequest[];
  created: number;
  updated: number;
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

/** Add a request to a collection (returns new collection). */
export function addRequest(collection: Collection, request: ApiRequest): Collection {
  return {
    ...collection,
    requests: [...collection.requests, request],
    updated: Date.now(),
  };
}

/** Remove a request from a collection by ID. */
export function removeRequest(collection: Collection, requestId: string): Collection {
  return {
    ...collection,
    requests: collection.requests.filter(r => r.id !== requestId),
    updated: Date.now(),
  };
}

/** Update a request within a collection. */
export function updateRequest(collection: Collection, updated: ApiRequest): Collection {
  return {
    ...collection,
    requests: collection.requests.map(r => r.id === updated.id ? updated : r),
    updated: Date.now(),
  };
}

/** Move a request within a collection (reorder). */
export function moveRequest(collection: Collection, requestId: string, newIndex: number): Collection {
  const requests = [...collection.requests];
  const oldIndex = requests.findIndex(r => r.id === requestId);
  if (oldIndex === -1) return collection;
  if (newIndex < 0 || newIndex >= requests.length) return collection;

  const [moved] = requests.splice(oldIndex, 1);
  requests.splice(newIndex, 0, moved);

  return {
    ...collection,
    requests,
    updated: Date.now(),
  };
}

/** Find a request in a collection by ID. */
export function findRequest(collection: Collection, requestId: string): ApiRequest | undefined {
  return collection.requests.find(r => r.id === requestId);
}

/** Sort collections by last updated (most recent first). */
export function sortByUpdated(collections: Collection[]): Collection[] {
  return [...collections].sort((a, b) => b.updated - a.updated);
}

/** Sort collections alphabetically by name. */
export function sortByName(collections: Collection[]): Collection[] {
  return [...collections].sort((a, b) => a.name.localeCompare(b.name));
}

/** Search collections by name or description. */
export function searchCollections(collections: Collection[], query: string): Collection[] {
  const q = query.toLowerCase();
  return collections.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.description.toLowerCase().includes(q) ||
    c.requests.some(r => r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q))
  );
}

/** Duplicate a collection with a new ID and name. */
export function duplicateCollection(collection: Collection): Collection {
  const now = Date.now();
  return {
    ...collection,
    id: generateId(),
    name: `${collection.name} (copy)`,
    requests: collection.requests.map(r => ({ ...r, id: generateId() })),
    created: now,
    updated: now,
  };
}

/** Get total request count across multiple collections. */
export function totalRequests(collections: Collection[]): number {
  return collections.reduce((sum, c) => sum + c.requests.length, 0);
}
