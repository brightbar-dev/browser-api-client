import { describe, it, expect } from 'vitest';
import { runItems, failedItems, type RunItem, type RunSender, type RunItemResult } from '../utils/runner';
import type { AssertionResult } from '../utils/assertions';
import { newRequest } from '../utils/request';

function item(id: string, folder: string | null = null): RunItem {
  return { id, name: `Request ${id}`, folder, request: newRequest(id) };
}

const assertion = (pass: boolean): AssertionResult => ({ id: 'a', pass, actual: '', message: pass ? 'ok' : 'nope' });
const items = (...ids: string[]) => ids.map(id => item(id));
const ok: RunSender = async () => ({ status: 200, time: 10, assertions: [] });
const tick = () => new Promise(resolve => setTimeout(resolve, 1));

describe('runItems', () => {
  it('runs items one at a time, in order', async () => {
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const send: RunSender = async it => {
      active++;
      maxActive = Math.max(maxActive, active);
      log.push(`start ${it.id}`);
      await tick();
      log.push(`end ${it.id}`);
      active--;
      return { status: 200, time: 5, assertions: [] };
    };
    const summary = await runItems(items('a', 'b', 'c'), send);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(maxActive).toBe(1);
    expect(summary.results.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('decides pass and fail from errors, status and assertions', async () => {
    const outcomes: Record<string, Awaited<ReturnType<RunSender>>> = {
      noAssertions: { status: 404, time: 1, assertions: [] },
      allPass: { status: 200, time: 1, assertions: [assertion(true), assertion(true)] },
      oneFails: { status: 200, time: 1, assertions: [assertion(true), assertion(false)] },
      error: { status: 0, time: 1, error: 'Failed to fetch', assertions: [] },
      noResponse: { status: 0, time: 1, assertions: [] },
    };
    const summary = await runItems(items(...Object.keys(outcomes)), async it => outcomes[it.id]!);
    expect(summary.results.map(r => [r.id, r.passed])).toEqual([
      ['noAssertions', true], ['allPass', true], ['oneFails', false], ['error', false], ['noResponse', false],
    ]);
    expect(summary.results[3]!.error).toBe('Failed to fetch');
    expect(summary).toMatchObject({ passed: 2, failed: 3, skipped: 0, aborted: false });
  });

  it('turns a throwing sender into an error result', async () => {
    let t = 100;
    const send: RunSender = async it => {
      if (it.id === 'async') throw new Error('boom');
      if (it.id === 'value') throw 'plain string';
      return { status: 201, time: 3, assertions: [] };
    };
    const syncThrow = (() => { throw new Error('sync'); }) as unknown as RunSender;
    const summary = await runItems(items('async', 'value', 'fine'), send, { now: () => (t += 10) });
    expect(summary.results.map(r => [r.id, r.status, r.error, r.passed])).toEqual([
      ['async', 0, 'boom', false], ['value', 0, 'plain string', false], ['fine', 201, undefined, true],
    ]);
    expect(summary.results[0]!.time).toBe(10);
    await expect(runItems(items('x'), syncThrow)).resolves.toMatchObject({ failed: 1, results: [{ error: 'sync' }] });
  });

  it('passes the signal to the sender', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    await runItems(items('a'), async (_it, signal) => {
      received = signal;
      return { status: 200, time: 1, assertions: [] };
    }, { signal: controller.signal });
    expect(received).toBe(controller.signal);
  });

  it('skips everything when aborted before starting', async () => {
    let calls = 0;
    const summary = await runItems(items('a', 'b'), async () => {
      calls++;
      return { status: 200, time: 1, assertions: [] };
    }, { signal: AbortSignal.abort() });
    expect(calls).toBe(0);
    expect(summary).toMatchObject({ aborted: true, passed: 0, failed: 0, skipped: 2 });
    expect(summary.results.every(r => r.skipped && !r.passed)).toBe(true);
  });

  it('skips the remaining items after an abort between requests', async () => {
    const controller = new AbortController();
    const summary = await runItems(items('a', 'b', 'c', 'd'), ok, {
      signal: controller.signal,
      onResult: r => { if (r.id === 'b') controller.abort(); },
    });
    expect(summary.results.map(r => [r.id, !!r.skipped])).toEqual([['a', false], ['b', false], ['c', true], ['d', true]]);
    expect(summary).toMatchObject({ aborted: true, passed: 2, skipped: 2 });
  });

  it('skips the request that was in flight when the run was aborted', async () => {
    const controller = new AbortController();
    const summary = await runItems(items('a', 'b', 'c'), async it => {
      if (it.id === 'b') controller.abort();
      return { status: 200, time: 1, assertions: [] };
    }, { signal: controller.signal });
    expect(summary.results.map(r => [r.id, !!r.skipped, r.error])).toEqual([
      ['a', false, undefined], ['b', true, 'Run aborted'], ['c', true, undefined],
    ]);
    expect(summary).toMatchObject({ aborted: true, passed: 1, skipped: 2 });
  });

  it('does not wait for a sender that ignores the abort', async () => {
    const controller = new AbortController();
    const summary = await runItems(items('hang', 'next'), (it) => {
      setTimeout(() => controller.abort(), 5);
      return new Promise(() => {});
    }, { signal: controller.signal });
    expect(summary.results.map(r => [r.id, r.skipped, r.error])).toEqual([['hang', true, 'Run aborted'], ['next', true, undefined]]);
    expect(summary.aborted).toBe(true);
  });

  it('marks an item skipped when its request is rejected by the abort', async () => {
    const controller = new AbortController();
    const summary = await runItems(items('a'), async (_it, signal) => {
      controller.abort();
      throw signal.reason;
    }, { signal: controller.signal });
    expect(summary).toMatchObject({ aborted: true, skipped: 1, failed: 0 });
  });

  it('stops after the first failure when asked', async () => {
    const send: RunSender = async it => ({ status: it.id === 'b' ? 500 : 200, time: 1, assertions: [assertion(it.id !== 'b')] });
    const stopped = await runItems(items('a', 'b', 'c'), send, { stopOnFailure: true });
    expect(stopped.results.map(r => [r.id, r.passed, !!r.skipped])).toEqual([['a', true, false], ['b', false, false], ['c', false, true]]);
    expect(stopped).toMatchObject({ passed: 1, failed: 1, skipped: 1, aborted: false });

    const continued = await runItems(items('a', 'b', 'c'), send);
    expect(continued).toMatchObject({ passed: 2, failed: 1, skipped: 0 });
  });

  it('waits between requests but not before the first', async () => {
    const pauses: number[] = [];
    const sleep = async (ms: number) => { pauses.push(ms); };
    await runItems(items('a', 'b', 'c'), ok, { delayMs: 250, sleep });
    expect(pauses).toEqual([250, 250]);

    pauses.length = 0;
    await runItems(items('a', 'b'), ok, { sleep });
    expect(pauses).toEqual([]);
  });

  it('ends a pause early on abort', async () => {
    const controller = new AbortController();
    const summary = await runItems(items('a', 'b'), async () => {
      setTimeout(() => controller.abort(), 5);
      return { status: 200, time: 1, assertions: [] };
    }, { signal: controller.signal, delayMs: 60_000, sleep: () => new Promise(() => {}) });
    expect(summary.results.map(r => [r.id, !!r.skipped])).toEqual([['a', false], ['b', true]]);
    expect(summary.aborted).toBe(true);
  });

  it('reports each result as it happens, even if the callback throws', async () => {
    const seen: Array<[string, number, boolean]> = [];
    const summary = await runItems(items('a', 'b', 'c'), async it => ({ status: it.id === 'a' ? 500 : 200, time: 1, assertions: [assertion(it.id !== 'a')] }), {
      stopOnFailure: true,
      onResult: (r: RunItemResult, index: number) => {
        seen.push([r.id, index, !!r.skipped]);
        throw new Error('UI bug');
      },
    });
    expect(seen).toEqual([['a', 0, false], ['b', 1, true], ['c', 2, true]]);
    expect(summary.results).toHaveLength(3);
  });

  it('stamps the run with the injected clock and copies item fields', async () => {
    let t = 0;
    const summary = await runItems([item('a', 'Users')], ok, { now: () => ++t });
    expect(summary.startedAt).toBe(1);
    expect(summary.finishedAt).toBeGreaterThan(summary.startedAt);
    expect(summary.results[0]).toEqual({
      id: 'a', name: 'Request a', folder: 'Users', status: 200, time: 10, assertions: [], passed: true,
    });
  });

  it('handles an empty run', async () => {
    expect(await runItems([], ok, { now: () => 5 })).toEqual({
      startedAt: 5, finishedAt: 5, results: [], passed: 0, failed: 0, skipped: 0, aborted: false,
    });
  });
});

describe('failedItems', () => {
  it('returns items that ran and did not pass, in order', async () => {
    const list = items('a', 'b', 'c', 'd');
    const send: RunSender = async it => ({ status: 200, time: 1, assertions: [assertion(it.id === 'a')] });
    const summary = await runItems(list, send, { stopOnFailure: false });
    expect(failedItems(list, summary).map(i => i.id)).toEqual(['b', 'c', 'd']);

    const stopped = await runItems(list, send, { stopOnFailure: true });
    expect(failedItems(list, stopped).map(i => i.id)).toEqual(['b']);
  });
});
