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
} from '../utils/collections';
import { newRequest } from '../utils/request';

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
    expect(updated.requests[0].name).toBe('GET users');
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
    expect(result.requests[0].name).toBe('Updated');
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
    expect(col.requests[0].name).toBe('Third');
    expect(col.requests[1].name).toBe('First');
    expect(col.requests[2].name).toBe('Second');
  });

  it('returns unchanged for invalid index', () => {
    const c = addRequest(newCollection('Test'), newRequest());
    const result = moveRequest(c, c.requests[0].id, 5);
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
    expect(sorted[0].name).toBe('New');
  });
});

describe('sortByName', () => {
  it('sorts alphabetically', () => {
    const c1 = newCollection('Zebra');
    const c2 = newCollection('Alpha');
    const sorted = sortByName([c1, c2]);
    expect(sorted[0].name).toBe('Alpha');
  });
});

describe('searchCollections', () => {
  it('searches by name', () => {
    const c1 = newCollection('User API');
    const c2 = newCollection('Auth Endpoints');
    const results = searchCollections([c1, c2], 'user');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('User API');
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
    expect(copy.requests[0].id).not.toBe(original.requests[0].id);
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
});
