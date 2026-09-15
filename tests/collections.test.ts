import { describe, it, expect } from 'vitest';
import {
  newCollection,
  addRequest,
  removeRequest,
  updateRequest,
  moveRequest,
  findRequest,
  sortByUpdated,
  sortByName,
  searchCollections,
  duplicateCollection,
  totalRequests,
  findRequestLocation,
  findRequestAnywhere,
  allRequests,
  countRequests,
  renameCollection,
  addFolder,
  renameFolder,
  deleteFolder,
  duplicateFolder,
  moveFolder,
  upsertRequest,
  removeRequestAnywhere,
  duplicateRequestAnywhere,
  moveRequestTo,
  filterCollectionTree,
} from '../utils/collections';
import type { Collection } from '../utils/collections';
import { newRequest } from '../utils/request';
import type { ApiRequest } from '../utils/request';

const req = (id: string, name: string, extra: Partial<ApiRequest> = {}): ApiRequest => ({ ...newRequest(name), id, ...extra });

/** Root: r1, r2. Folders: f1 Users (u1, u2), f2 Orders (o1), f3 Empty. */
function tree(): Collection {
  return {
    id: 'c1',
    name: 'Store',
    description: 'Shop API',
    requests: [req('r1', 'Health', { url: 'https://api.test/health' }), req('r2', 'Version', { url: 'https://api.test/version' })],
    folders: [
      {
        id: 'f1',
        name: 'Users',
        requests: [
          req('u1', 'List users', { url: 'https://api.test/users' }),
          req('u2', 'Create user', { method: 'POST', url: 'https://api.test/users' }),
        ],
      },
      { id: 'f2', name: 'Orders', requests: [req('o1', 'Get order', { url: 'https://api.test/orders/1', headers: [{ key: 'X-A', value: '1', enabled: true }] })] },
      { id: 'f3', name: 'Empty', requests: [] },
    ],
    created: 1,
    updated: 1,
  };
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const child of Object.values(v)) deepFreeze(child);
    Object.freeze(v);
  }
  return v;
}

/** A frozen tree: any mutation by the code under test throws. */
const frozen = () => deepFreeze(tree());
const ids = (list: ApiRequest[] | undefined) => (list ?? []).map(r => r.id);
const folder = (c: Collection, id: string) => c.folders!.find(f => f.id === id)!;
const folderIds = (c: Collection) => (c.folders ?? []).map(f => f.id);

describe('newCollection', () => {
  it('creates a collection with defaults', () => {
    const c = newCollection('Test');
    expect(c.name).toBe('Test');
    expect(c.requests).toEqual([]);
    expect(c.id).toBeTruthy();
    expect(c.created).toBeGreaterThan(0);
  });

  it('uses default name', () => {
    const c = newCollection();
    expect(c.name).toBe('New Collection');
  });
});

describe('addRequest', () => {
  it('adds a request to collection', () => {
    const c = newCollection('Test');
    const r = newRequest('GET users');
    const updated = addRequest(c, r);
    expect(updated.requests).toHaveLength(1);
    expect(updated.requests[0]!.name).toBe('GET users');
  });

  it('does not mutate original', () => {
    const c = newCollection('Test');
    addRequest(c, newRequest());
    expect(c.requests).toHaveLength(0);
  });
});

describe('removeRequest', () => {
  it('removes a request by ID', () => {
    const c = newCollection('Test');
    const r = newRequest('To remove');
    const with1 = addRequest(c, r);
    const removed = removeRequest(with1, r.id);
    expect(removed.requests).toHaveLength(0);
  });

  it('no-ops for unknown ID', () => {
    const c = addRequest(newCollection('Test'), newRequest());
    const result = removeRequest(c, 'nonexistent');
    expect(result.requests).toHaveLength(1);
  });
});

describe('updateRequest', () => {
  it('updates a request in place', () => {
    const r = newRequest('Original');
    const c = addRequest(newCollection('Test'), r);
    const updatedReq = { ...r, name: 'Updated' };
    const result = updateRequest(c, updatedReq);
    expect(result.requests[0]!.name).toBe('Updated');
  });
});

describe('moveRequest', () => {
  it('moves a request to a new position', () => {
    const c = newCollection('Test');
    const r1 = newRequest('First');
    const r2 = newRequest('Second');
    const r3 = newRequest('Third');
    let col = addRequest(addRequest(addRequest(c, r1), r2), r3);
    col = moveRequest(col, r3.id, 0);
    expect(col.requests[0]!.name).toBe('Third');
    expect(col.requests[1]!.name).toBe('First');
    expect(col.requests[2]!.name).toBe('Second');
  });

  it('returns unchanged for invalid index', () => {
    const c = addRequest(newCollection('Test'), newRequest());
    const result = moveRequest(c, c.requests[0]!.id, 5);
    expect(result).toBe(c);
  });
});

describe('findRequest', () => {
  it('finds a request by ID', () => {
    const r = newRequest('Target');
    const c = addRequest(newCollection('Test'), r);
    expect(findRequest(c, r.id)?.name).toBe('Target');
  });

  it('returns undefined for unknown ID', () => {
    const c = newCollection('Test');
    expect(findRequest(c, 'nope')).toBeUndefined();
  });
});

describe('sortByUpdated', () => {
  it('sorts most recent first', () => {
    const c1 = { ...newCollection('Old'), updated: 1000 };
    const c2 = { ...newCollection('New'), updated: 2000 };
    const sorted = sortByUpdated([c1, c2]);
    expect(sorted[0]!.name).toBe('New');
  });
});

describe('sortByName', () => {
  it('sorts alphabetically', () => {
    const c1 = newCollection('Zebra');
    const c2 = newCollection('Alpha');
    const sorted = sortByName([c1, c2]);
    expect(sorted[0]!.name).toBe('Alpha');
  });
});

describe('searchCollections', () => {
  it('searches by name', () => {
    const c1 = newCollection('User API');
    const c2 = newCollection('Auth Endpoints');
    const results = searchCollections([c1, c2], 'user');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('User API');
  });

  it('searches request URLs', () => {
    const c = addRequest(newCollection('Test'), { ...newRequest(), url: 'https://api.example.com/users' });
    const results = searchCollections([c], 'example.com');
    expect(results).toHaveLength(1);
  });

  it('is case insensitive', () => {
    const c = newCollection('User API');
    expect(searchCollections([c], 'USER')).toHaveLength(1);
  });
});

describe('duplicateCollection', () => {
  it('creates a copy with new ID', () => {
    const original = addRequest(newCollection('Original'), newRequest());
    const copy = duplicateCollection(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Original (copy)');
    expect(copy.requests).toHaveLength(1);
    expect(copy.requests[0]!.id).not.toBe(original.requests[0]!.id);
  });
});

describe('totalRequests', () => {
  it('counts requests across collections', () => {
    const c1 = addRequest(addRequest(newCollection('A'), newRequest()), newRequest());
    const c2 = addRequest(newCollection('B'), newRequest());
    expect(totalRequests([c1, c2])).toBe(3);
  });

  it('returns 0 for empty', () => {
    expect(totalRequests([])).toBe(0);
  });

  it('counts requests in folders', () => {
    expect(totalRequests([tree(), addRequest(newCollection('B'), newRequest())])).toBe(6);
  });
});

describe('root-only operations ignore folders', () => {
  it('findRequest, removeRequest and updateRequest do not reach into folders', () => {
    const c = tree();
    expect(findRequest(c, 'u1')).toBeUndefined();
    expect(ids(folder(removeRequest(c, 'u1'), 'f1').requests)).toEqual(['u1', 'u2']);
    expect(folder(updateRequest(c, req('u1', 'Changed')), 'f1').requests[0]!.name).toBe('List users');
  });
});

describe('findRequestLocation', () => {
  const other: Collection = { ...newCollection('Other'), id: 'c2', requests: [req('x1', 'X')], folders: [{ id: 'g1', name: 'G', requests: [req('y1', 'Y'), req('y2', 'Y2')] }] };

  it('finds a root request', () => {
    expect(findRequestLocation([tree()], 'r2')).toEqual({ collectionId: 'c1', folderId: null, index: 1 });
  });

  it('finds a request in a folder', () => {
    expect(findRequestLocation([tree()], 'u2')).toEqual({ collectionId: 'c1', folderId: 'f1', index: 1 });
    expect(findRequestLocation([tree()], 'o1')).toEqual({ collectionId: 'c1', folderId: 'f2', index: 0 });
  });

  it('searches every collection', () => {
    expect(findRequestLocation([tree(), other], 'y2')).toEqual({ collectionId: 'c2', folderId: 'g1', index: 1 });
    expect(findRequestLocation([tree(), other], 'x1')).toEqual({ collectionId: 'c2', folderId: null, index: 0 });
  });

  it('returns null when missing, including for collections without folders', () => {
    expect(findRequestLocation([tree(), other], 'nope')).toBeNull();
    expect(findRequestLocation([newCollection()], 'nope')).toBeNull();
    expect(findRequestLocation([], 'r1')).toBeNull();
  });
});

describe('findRequestAnywhere', () => {
  it('finds root and folder requests', () => {
    expect(findRequestAnywhere(tree(), 'r1')?.name).toBe('Health');
    expect(findRequestAnywhere(tree(), 'o1')?.name).toBe('Get order');
  });

  it('returns undefined when missing', () => {
    expect(findRequestAnywhere(tree(), 'nope')).toBeUndefined();
    expect(findRequestAnywhere(newCollection(), 'nope')).toBeUndefined();
  });
});

describe('allRequests', () => {
  it('lists root requests first, then each folder in order, with the folder', () => {
    const c = tree();
    const all = allRequests(c);
    expect(all.map(x => x.request.id)).toEqual(['r1', 'r2', 'u1', 'u2', 'o1']);
    expect(all.map(x => x.folder?.id ?? null)).toEqual([null, null, 'f1', 'f1', 'f2']);
    expect(all[2]!.folder).toBe(c.folders![0]);
    expect(all[0]!.request).toBe(c.requests[0]);
  });

  it('handles a collection without folders', () => {
    const c = addRequest(newCollection(), req('a', 'A'));
    expect(allRequests(c)).toEqual([{ request: c.requests[0], folder: null }]);
  });
});

describe('countRequests', () => {
  it('counts root and folder requests', () => {
    expect(countRequests(tree())).toBe(5);
    expect(countRequests(newCollection())).toBe(0);
    expect(countRequests(addRequest(newCollection(), newRequest()))).toBe(1);
  });
});

describe('renameCollection', () => {
  it('renames and bumps updated without mutating', () => {
    const c = frozen();
    const r = renameCollection(c, 'Shop');
    expect(r.name).toBe('Shop');
    expect(r.updated).toBeGreaterThan(1);
    expect(r).not.toBe(c);
    expect(c).toEqual(tree());
  });
});

describe('addFolder', () => {
  it('appends an empty folder named "New folder" by default', () => {
    const c = frozen();
    const { collection, folder: f } = addFolder(c);
    expect(f.name).toBe('New folder');
    expect(f.requests).toEqual([]);
    expect(f.id).toBeTruthy();
    expect(folderIds(collection)).toEqual(['f1', 'f2', 'f3', f.id]);
    expect(collection.folders![3]).toBe(f);
    expect(collection.updated).toBeGreaterThan(1);
    expect(c).toEqual(tree());
  });

  it('uses the given name and works on a collection without folders', () => {
    const c = deepFreeze(newCollection('Plain'));
    const { collection, folder: f } = addFolder(c, 'Auth');
    expect(collection.folders).toEqual([{ id: f.id, name: 'Auth', requests: [] }]);
    expect(c.folders).toBeUndefined();
  });

  it('gives each folder a fresh id', () => {
    const a = addFolder(tree()).folder.id;
    const b = addFolder(tree()).folder.id;
    expect(a).not.toBe(b);
  });
});

describe('renameFolder', () => {
  it('renames one folder', () => {
    const c = frozen();
    const r = renameFolder(c, 'f2', 'Purchases');
    expect(r.folders!.map(f => f.name)).toEqual(['Users', 'Purchases', 'Empty']);
    expect(folder(r, 'f2').requests).toEqual(tree().folders![1]!.requests);
    expect(r.updated).toBeGreaterThan(1);
    expect(c).toEqual(tree());
  });

  it('returns the collection unchanged for an unknown folder', () => {
    const c = tree();
    expect(renameFolder(c, 'nope', 'X')).toBe(c);
    const plain = newCollection();
    expect(renameFolder(plain, 'nope', 'X')).toBe(plain);
  });
});

describe('deleteFolder', () => {
  it('removes the folder and its requests', () => {
    const c = frozen();
    const r = deleteFolder(c, 'f1');
    expect(folderIds(r)).toEqual(['f2', 'f3']);
    expect(countRequests(r)).toBe(3);
    expect(findRequestAnywhere(r, 'u1')).toBeUndefined();
    expect(r.updated).toBeGreaterThan(1);
    expect(c).toEqual(tree());
  });

  it('returns the collection unchanged for an unknown folder', () => {
    const c = tree();
    expect(deleteFolder(c, 'nope')).toBe(c);
  });
});

describe('duplicateFolder', () => {
  it('inserts a copy right after, named "X copy", with fresh ids', () => {
    const c = frozen();
    const r = duplicateFolder(c, 'f1');
    expect(r.folders!.map(f => f.name)).toEqual(['Users', 'Users copy', 'Orders', 'Empty']);
    const copy = r.folders![1]!;
    expect(copy.id).not.toBe('f1');
    expect(copy.requests.map(x => x.name)).toEqual(['List users', 'Create user']);
    expect(copy.requests.map(x => x.id)).not.toContain('u1');
    expect(copy.requests.map(x => x.id)).not.toContain('u2');
    expect(new Set(copy.requests.map(x => x.id)).size).toBe(2);
    expect(copy.requests[1]!.method).toBe('POST');
    expect(r.updated).toBeGreaterThan(1);
    expect(c).toEqual(tree());
  });

  it('deep-copies the requests', () => {
    const r = duplicateFolder(tree(), 'f2');
    const original = r.folders![1]!.requests[0]!;
    const copy = r.folders![2]!.requests[0]!;
    expect(copy.headers).toEqual(original.headers);
    expect(copy.headers).not.toBe(original.headers);
    expect(copy.auth).not.toBe(original.auth);
  });

  it('duplicates the last folder at the end', () => {
    expect(duplicateFolder(tree(), 'f3').folders!.map(f => f.name)).toEqual(['Users', 'Orders', 'Empty', 'Empty copy']);
  });

  it('returns the collection unchanged for an unknown folder', () => {
    const c = tree();
    expect(duplicateFolder(c, 'nope')).toBe(c);
  });
});

describe('moveFolder', () => {
  it('moves a folder to a new index', () => {
    const c = frozen();
    expect(folderIds(moveFolder(c, 'f3', 0))).toEqual(['f3', 'f1', 'f2']);
    expect(folderIds(moveFolder(c, 'f1', 1))).toEqual(['f2', 'f1', 'f3']);
    expect(moveFolder(c, 'f1', 1).updated).toBeGreaterThan(1);
    expect(c).toEqual(tree());
  });

  it('clamps the index', () => {
    expect(folderIds(moveFolder(tree(), 'f1', 99))).toEqual(['f2', 'f3', 'f1']);
    expect(folderIds(moveFolder(tree(), 'f3', -4))).toEqual(['f3', 'f1', 'f2']);
  });

  it('returns the collection unchanged for an unknown folder', () => {
    const c = tree();
    expect(moveFolder(c, 'nope', 0)).toBe(c);
  });
});

describe('upsertRequest', () => {
  it('replaces a root request in place, ignoring folderId', () => {
    const c = frozen();
    const r = upsertRequest(c, req('r1', 'Health v2'), 'f1');
    expect(ids(r.requests)).toEqual(['r1', 'r2']);
    expect(r.requests[0]!.name).toBe('Health v2');
    expect(ids(folder(r, 'f1').requests)).toEqual(['u1', 'u2']);
    expect(r.updated).toBeGreaterThan(1);
    expect(c).toEqual(tree());
  });

  it('replaces a folder request in place', () => {
    const r = upsertRequest(frozen(), req('u1', 'All users'), null);
    expect(ids(folder(r, 'f1').requests)).toEqual(['u1', 'u2']);
    expect(folder(r, 'f1').requests[0]!.name).toBe('All users');
    expect(ids(r.requests)).toEqual(['r1', 'r2']);
  });

  it('appends a new request to the given folder', () => {
    const r = upsertRequest(frozen(), req('n1', 'New'), 'f3');
    expect(ids(folder(r, 'f3').requests)).toEqual(['n1']);
    expect(countRequests(r)).toBe(6);
  });

  it('appends a new request to the root for null or an unknown folder', () => {
    expect(ids(upsertRequest(frozen(), req('n1', 'New'), null).requests)).toEqual(['r1', 'r2', 'n1']);
    expect(ids(upsertRequest(frozen(), req('n2', 'New'), 'nope').requests)).toEqual(['r1', 'r2', 'n2']);
    const plain = upsertRequest(deepFreeze(newCollection()), req('n3', 'New'), 'nope');
    expect(ids(plain.requests)).toEqual(['n3']);
    expect('folders' in plain).toBe(false);
  });
});

describe('removeRequestAnywhere', () => {
  it('removes a root request', () => {
    const c = frozen();
    const r = removeRequestAnywhere(c, 'r1');
    expect(ids(r.requests)).toEqual(['r2']);
    expect(countRequests(r)).toBe(4);
    expect(r.updated).toBeGreaterThan(1);
    expect(c).toEqual(tree());
  });

  it('removes a folder request', () => {
    const r = removeRequestAnywhere(frozen(), 'u2');
    expect(ids(folder(r, 'f1').requests)).toEqual(['u1']);
    expect(ids(r.requests)).toEqual(['r1', 'r2']);
  });

  it('returns the collection unchanged for an unknown request', () => {
    const c = tree();
    expect(removeRequestAnywhere(c, 'nope')).toBe(c);
  });
});

describe('duplicateRequestAnywhere', () => {
  it('inserts a copy right after a root request', () => {
    const c = frozen();
    const { collection, request } = duplicateRequestAnywhere(c, 'r1');
    expect(request).not.toBeNull();
    expect(request!.name).toBe('Health copy');
    expect(request!.id).not.toBe('r1');
    expect(request!.url).toBe('https://api.test/health');
    expect(ids(collection.requests)).toEqual(['r1', request!.id, 'r2']);
    expect(collection.requests[1]).toBe(request);
    expect(collection.updated).toBeGreaterThan(1);
    expect(c).toEqual(tree());
  });

  it('inserts a copy right after a folder request, deep-copied', () => {
    const { collection, request } = duplicateRequestAnywhere(frozen(), 'o1');
    expect(ids(folder(collection, 'f2').requests)).toEqual(['o1', request!.id]);
    expect(request!.name).toBe('Get order copy');
    expect(request!.headers).toEqual(folder(collection, 'f2').requests[0]!.headers);
    expect(request!.headers).not.toBe(folder(collection, 'f2').requests[0]!.headers);
  });

  it('returns the collection unchanged and null for an unknown request', () => {
    const c = tree();
    expect(duplicateRequestAnywhere(c, 'nope')).toEqual({ collection: c, request: null });
    expect(duplicateRequestAnywhere(c, 'nope').collection).toBe(c);
  });
});

describe('moveRequestTo', () => {
  it('moves a root request into a folder at an index', () => {
    const c = frozen();
    const r = moveRequestTo(c, 'r1', { folderId: 'f1', index: 1 });
    expect(ids(r.requests)).toEqual(['r2']);
    expect(ids(folder(r, 'f1').requests)).toEqual(['u1', 'r1', 'u2']);
    expect(folder(r, 'f1').requests[1]).toBe(c.requests[0]);
    expect(r.updated).toBeGreaterThan(1);
    expect(c).toEqual(tree());
  });

  it('moves a folder request to the root', () => {
    const r = moveRequestTo(frozen(), 'u2', { folderId: null, index: 0 });
    expect(ids(r.requests)).toEqual(['u2', 'r1', 'r2']);
    expect(ids(folder(r, 'f1').requests)).toEqual(['u1']);
  });

  it('moves between folders, including into an empty one', () => {
    const r = moveRequestTo(frozen(), 'o1', { folderId: 'f3', index: 0 });
    expect(ids(folder(r, 'f2').requests)).toEqual([]);
    expect(ids(folder(r, 'f3').requests)).toEqual(['o1']);
  });

  it('reorders within the same list, clamping to the length after removal', () => {
    expect(ids(moveRequestTo(frozen(), 'u1', { folderId: 'f1', index: 1 }).folders![0]!.requests)).toEqual(['u2', 'u1']);
    expect(ids(moveRequestTo(frozen(), 'u1', { folderId: 'f1', index: 5 }).folders![0]!.requests)).toEqual(['u2', 'u1']);
    expect(ids(moveRequestTo(frozen(), 'r2', { folderId: null, index: 0 }).requests)).toEqual(['r2', 'r1']);
  });

  it('clamps out-of-range indexes', () => {
    expect(ids(folder(moveRequestTo(frozen(), 'r1', { folderId: 'f1', index: 99 }), 'f1').requests)).toEqual(['u1', 'u2', 'r1']);
    expect(ids(folder(moveRequestTo(frozen(), 'r1', { folderId: 'f1', index: -3 }), 'f1').requests)).toEqual(['r1', 'u1', 'u2']);
  });

  it('returns the collection unchanged for an unknown request or destination folder', () => {
    const c = tree();
    expect(moveRequestTo(c, 'nope', { folderId: null, index: 0 })).toBe(c);
    expect(moveRequestTo(c, 'r1', { folderId: 'nope', index: 0 })).toBe(c);
  });
});

describe('filterCollectionTree', () => {
  const other: Collection = { ...newCollection('Billing'), id: 'c2', requests: [req('b1', 'Invoices', { url: 'https://billing.test/invoices' })] };

  it('returns the input for an empty query', () => {
    const list = [tree(), other];
    expect(filterCollectionTree(list, '')).toBe(list);
    expect(filterCollectionTree(list, '   ')).toBe(list);
  });

  it('keeps a collection whose name matches whole', () => {
    const c = tree();
    const r = filterCollectionTree([c, other], 'STORE');
    expect(r).toHaveLength(1);
    expect(r[0]).toBe(c);
  });

  it('keeps a folder whose name matches whole and drops the rest', () => {
    const r = filterCollectionTree([tree(), other], 'user');
    expect(r).toHaveLength(1);
    expect(ids(r[0]!.requests)).toEqual([]);
    expect(r[0]!.folders).toEqual([tree().folders![0]]);
  });

  it('keeps a folder whose name matches even when it is empty', () => {
    const r = filterCollectionTree([tree()], 'empty');
    expect(folderIds(r[0]!)).toEqual(['f3']);
  });

  it('keeps only requests whose method matches, dropping empty folders', () => {
    const r = filterCollectionTree([tree(), other], 'post');
    expect(r).toHaveLength(1);
    expect(ids(r[0]!.requests)).toEqual([]);
    expect(r[0]!.folders!.map(f => [f.id, ids(f.requests)])).toEqual([['f1', ['u2']]]);
  });

  it('matches request names and URLs', () => {
    expect(ids(filterCollectionTree([tree()], 'version')[0]!.requests)).toEqual(['r2']);
    expect(filterCollectionTree([tree()], 'version')[0]!.folders).toEqual([]);
    const byName = filterCollectionTree([tree(), other], 'invoices');
    expect(byName.map(c => c.id)).toEqual(['c2']);
    expect('folders' in byName[0]!).toBe(false);
    expect(filterCollectionTree([tree()], 'orders/1')[0]!.folders!.map(f => f.id)).toEqual(['f2']);
  });

  it('drops collections with nothing matching', () => {
    expect(filterCollectionTree([tree(), other], 'zzz')).toEqual([]);
  });

  it('does not mutate or bump updated', () => {
    const c = frozen();
    const r = filterCollectionTree([c], 'post');
    expect(r[0]!.updated).toBe(1);
    expect(c).toEqual(tree());
  });
});

describe('searchCollections with folders', () => {
  it('matches folder names and folder request names and URLs', () => {
    const plain = newCollection('Plain');
    expect(searchCollections([tree(), plain], 'orders')).toHaveLength(1);
    expect(searchCollections([tree(), plain], 'create user')).toHaveLength(1);
    expect(searchCollections([tree(), plain], 'orders/1')).toHaveLength(1);
    expect(searchCollections([tree(), plain], 'zzz')).toHaveLength(0);
  });
});

describe('duplicateCollection with folders', () => {
  it('gives folders and their requests fresh ids and keeps names', () => {
    const c = frozen();
    const copy = duplicateCollection(c);
    expect(copy.folders!.map(f => f.name)).toEqual(['Users', 'Orders', 'Empty']);
    for (const f of copy.folders!) expect(['f1', 'f2', 'f3']).not.toContain(f.id);
    const copiedIds = allRequests(copy).map(x => x.request.id);
    expect(copiedIds).toHaveLength(5);
    for (const id of ['r1', 'r2', 'u1', 'u2', 'o1']) expect(copiedIds).not.toContain(id);
    expect(allRequests(copy).map(x => x.request.name)).toEqual(allRequests(c).map(x => x.request.name));
    expect(c).toEqual(tree());
  });

  it('does not add folders to a collection without them', () => {
    expect('folders' in duplicateCollection(addRequest(newCollection('A'), newRequest()))).toBe(false);
  });
});
