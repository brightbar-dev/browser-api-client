/**
 * Collection runner orchestration. Pure: the HTTP work is an injected sender, so
 * this runs the same in the popup, a background worker or a test.
 */

import type { ApiRequest } from './request';
import type { AssertionResult } from './assertions';

export interface RunItem {
  id: string;
  name: string;
  folder: string | null;
  request: ApiRequest;
}

export interface RunItemResult {
  id: string;
  name: string;
  folder: string | null;
  /** 0 when there was no HTTP response. */
  status: number;
  time: number;
  error?: string;
  assertions: AssertionResult[];
  passed: boolean;
  skipped?: boolean;
}

export interface RunSummary {
  startedAt: number;
  finishedAt: number;
  results: RunItemResult[];
  passed: number;
  failed: number;
  skipped: number;
  aborted: boolean;
}

export type RunSender = (
  item: RunItem,
  signal: AbortSignal,
) => Promise<{ status: number; time: number; error?: string; assertions: AssertionResult[] }>;

export interface RunOptions {
  signal?: AbortSignal;
  /** Pause between requests (not before the first). */
  delayMs?: number;
  /** Skip the remaining items after the first item that does not pass. */
  stopOnFailure?: boolean;
  /** Called once per item, skipped ones included, in order. Errors it throws are ignored. */
  onResult?: (r: RunItemResult, index: number) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type SendOutcome =
  | { kind: 'value'; value: Awaited<ReturnType<RunSender>> }
  | { kind: 'error'; error: unknown }
  | { kind: 'aborted' };

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Resolves when `signal` aborts; `dispose` removes the listener. */
function whenAborted(signal: AbortSignal): { promise: Promise<'aborted'>; dispose: () => void } {
  let listener = () => {};
  const promise = new Promise<'aborted'>(resolve => {
    if (signal.aborted) {
      resolve('aborted');
      return;
    }
    listener = () => resolve('aborted');
    signal.addEventListener('abort', listener, { once: true });
  });
  return { promise, dispose: () => signal.removeEventListener('abort', listener) };
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

function skippedResult(item: RunItem, error?: string): RunItemResult {
  const r: RunItemResult = {
    id: item.id, name: item.name, folder: item.folder,
    status: 0, time: 0, assertions: [], passed: false, skipped: true,
  };
  if (error) r.error = error;
  return r;
}

/**
 * Whether an item passed: no error, an HTTP response (status > 0), and every
 * assertion passed. With no assertions, getting a response is enough.
 */
export function itemPassed(r: { status: number; error?: string; assertions: AssertionResult[] }): boolean {
  return !r.error && r.status > 0 && r.assertions.every(a => a.pass);
}

/**
 * Run items one at a time, in order. Never rejects: a throwing sender becomes an
 * error result. On abort (including mid-request) the current and remaining items
 * are marked skipped and `aborted` is true.
 */
export async function runItems(items: RunItem[], send: RunSender, opts: RunOptions = {}): Promise<RunSummary> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const delayMs = Math.max(0, opts.delayMs ?? 0);
  const signal = opts.signal ?? new AbortController().signal;

  const startedAt = now();
  const results: RunItemResult[] = [];
  let aborted = false;
  let halted = false;

  const emit = (r: RunItemResult, index: number) => {
    results.push(r);
    if (!opts.onResult) return;
    try {
      opts.onResult(r, index);
    } catch {
      // a UI callback must not break the run
    }
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (signal.aborted) aborted = true;

    if (!aborted && !halted && i > 0 && delayMs > 0) {
      const abort = whenAborted(signal);
      try {
        await Promise.race([Promise.resolve().then(() => sleep(delayMs)), abort.promise]);
      } catch {
        // a failing sleep just ends the pause
      } finally {
        abort.dispose();
      }
      if (signal.aborted) aborted = true;
    }

    if (aborted || halted) {
      emit(skippedResult(item), i);
      continue;
    }

    const t0 = now();
    const sent: Promise<SendOutcome> = Promise.resolve()
      .then(() => send(item, signal))
      .then(value => ({ kind: 'value' as const, value }), error => ({ kind: 'error' as const, error }));
    const abort = whenAborted(signal);
    const outcome = await Promise.race([sent, abort.promise.then((): SendOutcome => ({ kind: 'aborted' }))]);
    abort.dispose();

    if (outcome.kind === 'aborted' || (outcome.kind === 'error' && signal.aborted)) {
      aborted = true;
      emit(skippedResult(item, 'Run aborted'), i);
      continue;
    }

    let result: RunItemResult;
    if (outcome.kind === 'error') {
      result = {
        id: item.id, name: item.name, folder: item.folder,
        status: 0, time: Math.max(0, now() - t0), error: errorMessage(outcome.error) || 'Request failed',
        assertions: [], passed: false,
      };
    } else {
      const v = outcome.value ?? { status: 0, time: 0, assertions: [] };
      const status = Number.isFinite(v.status) ? v.status : 0;
      const assertions = Array.isArray(v.assertions) ? v.assertions : [];
      result = {
        id: item.id, name: item.name, folder: item.folder,
        status, time: Number.isFinite(v.time) ? v.time : 0, assertions, passed: false,
      };
      if (v.error) result.error = v.error;
      result.passed = itemPassed(result);
    }
    emit(result, i);
    if (!result.passed && opts.stopOnFailure) halted = true;
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.skipped) skipped++;
    else if (r.passed) passed++;
    else failed++;
  }
  return { startedAt, finishedAt: now(), results, passed, failed, skipped, aborted };
}

/** Items that ran and did not pass (skipped items are not included), in run order. */
export function failedItems(items: RunItem[], summary: RunSummary): RunItem[] {
  const failedIds = new Set(summary.results.filter(r => !r.skipped && !r.passed).map(r => r.id));
  return items.filter(item => failedIds.has(item.id));
}
