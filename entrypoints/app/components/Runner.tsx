import { useMemo, useRef, useState } from 'preact/hooks';
import { formatTime, statusColor } from '@/utils/request';
import * as col from '@/utils/collections';
import type { RunItem, RunItemResult, RunSender, RunSummary } from '@/utils/runner';
import { failedItems, runItems } from '@/utils/runner';
import { statusLabel } from '@/utils/http-status';
import { activeVariables, closeDialog, useApp } from '../store';
import { executeResolved, failureOf, prepareRequest, runTests } from '../send';
import { Dialog } from './Dialog';

const sender: RunSender = async (item, signal) => {
  let url = item.request.url;
  try {
    const prepared = await prepareRequest(item.request, activeVariables());
    url = prepared.request.url;
    if (prepared.error) return { status: 0, time: 0, error: prepared.error, assertions: [] };
    const response = await executeResolved(prepared.request, { signal, sendCookies: !!item.request.sendCookies });
    const { tests } = runTests(item.request, response);
    return { status: response.status, time: response.time, assertions: tests };
  } catch (e) {
    if (signal.aborted) throw e;
    const failure = e instanceof Error && !/fetch|network/i.test(e.message) && !(e instanceof TypeError) ? { title: e.message, detail: '' } : failureOf(e, false, url);
    return { status: 0, time: 0, error: failure.title, assertions: [] };
  }
};

export function RunnerDialog({ collectionId, folderId }: { collectionId: string; folderId: string | null }) {
  const collection = useApp((s) => s.collections.find((c) => c.id === collectionId));
  const envName = useApp((s) => s.environments.find((e) => e.id === s.activeEnvId)?.name);
  const allItems = useMemo<RunItem[]>(
    () =>
      collection
        ? col
            .allRequests(collection)
            .filter((x) => !folderId || x.folder?.id === folderId)
            .map(({ request, folder }) => ({ id: request.id, name: request.name, folder: folder?.name ?? null, request }))
        : [],
    [collection, folderId],
  );
  const [items, setItems] = useState<RunItem[]>(allItems);
  const [results, setResults] = useState<RunItemResult[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [delay, setDelay] = useState(0);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const controller = useRef<AbortController | null>(null);

  if (!collection) return null;
  const folderName = folderId ? collection.folders?.find((f) => f.id === folderId)?.name : undefined;
  const title = `Run “${folderName ?? collection.name}”`;

  const start = async (list: RunItem[]) => {
    controller.current = new AbortController();
    setItems(list);
    setResults([]);
    setSummary(null);
    setOpen({});
    setRunning(true);
    const s = await runItems(list, sender, {
      signal: controller.current.signal,
      delayMs: delay,
      stopOnFailure,
      onResult: (r) => setResults((prev) => [...prev, r]),
    });
    setSummary(s);
    setRunning(false);
  };

  const close = () => {
    controller.current?.abort();
    closeDialog();
  };

  const failed = summary ? failedItems(items, summary) : [];
  const done = results.length;

  return (
    <Dialog
      wide
      title={title}
      onClose={close}
      footer={
        <>
          <span class="bac-muted bac-foot-note">{envName ? `Environment: ${envName}` : 'No environment active'}</span>
          {running ? (
            <button type="button" class="bac-btn bac-btn-danger" onClick={() => controller.current?.abort()}>
              Stop
            </button>
          ) : (
            <>
              {failed.length > 0 && (
                <button type="button" class="bac-btn" onClick={() => void start(failed)}>
                  Re-run {failed.length} failed
                </button>
              )}
              <button type="button" class="bac-btn bac-btn-primary" disabled={!allItems.length} onClick={() => void start(allItems)}>
                {summary ? 'Run again' : `Run ${allItems.length} request${allItems.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </>
      }
    >
      <div class="bac-stack">
        <div class="bac-row bac-runner-options">
          <label class="bac-inline-field">
            <span>Delay between requests</span>
            <input class="bac-input bac-runner-delay" type="number" min={0} max={60000} step={100} value={delay} disabled={running} onInput={(e) => setDelay(Math.max(0, Number(e.currentTarget.value) || 0))} />
            <span>ms</span>
          </label>
          <label class="bac-inline-check">
            <input type="checkbox" checked={stopOnFailure} disabled={running} onChange={(e) => setStopOnFailure(e.currentTarget.checked)} /> Stop at the first failure
          </label>
        </div>

        {(running || summary) && (
          <div class="bac-run-summary" role="status" aria-live="polite">
            <div class="bac-progress" aria-hidden="true">
              <span style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
            </div>
            {summary ? (
              <p>
                <strong class="s-success bac-run-count">{summary.passed} passed</strong> · <strong class={summary.failed ? 's-server-error bac-run-count' : 'bac-run-count'}>{summary.failed} failed</strong>
                {summary.skipped > 0 && ` · ${summary.skipped} skipped`} · {formatTime(summary.finishedAt - summary.startedAt)}
                {summary.aborted && ' · stopped'}
              </p>
            ) : (
              <p>
                Running {Math.min(done + 1, items.length)} of {items.length}…
              </p>
            )}
          </div>
        )}

        {!allItems.length ? (
          <p class="bac-muted">There are no requests to run here yet.</p>
        ) : (
          <table class="bac-table bac-runner-table">
            <thead>
              <tr>
                <th scope="col">Result</th>
                <th scope="col">Request</th>
                <th scope="col">Status</th>
                <th scope="col">Time</th>
                <th scope="col">Tests</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const r = results[i];
                const tests = r?.assertions ?? [];
                const passedTests = tests.filter((t) => t.pass).length;
                const expandable = !!r && !r.passed && !r.skipped;
                return (
                  <>
                    <tr key={item.id} class={r ? (r.skipped ? 'is-skipped' : r.passed ? 'is-pass' : 'is-fail') : running && i === done ? 'is-running' : ''}>
                      <td>
                        <span class="bac-run-badge">{!r ? (running && i === done ? 'Running' : 'Pending') : r.skipped ? 'Skipped' : r.passed ? 'Pass' : 'Fail'}</span>
                      </td>
                      <td>
                        {expandable ? (
                          <button type="button" class="bac-link-btn bac-run-name" aria-expanded={!!open[item.id]} onClick={() => setOpen({ ...open, [item.id]: !open[item.id] })}>
                            <span class={`bac-method-tag m-${item.request.method.toLowerCase()}`}>{item.request.method}</span> {item.folder ? `${item.folder} / ` : ''}
                            {item.name}
                          </button>
                        ) : (
                          <span class="bac-run-name">
                            <span class={`bac-method-tag m-${item.request.method.toLowerCase()}`}>{item.request.method}</span> {item.folder ? `${item.folder} / ` : ''}
                            {item.name}
                          </span>
                        )}
                      </td>
                      <td class="bac-mono">{r && !r.skipped ? (r.status ? <span class={`s-${statusColor(r.status)} bac-status-text`}>{statusLabel(r.status, '')}</span> : '—') : ''}</td>
                      <td class="bac-mono">{r && !r.skipped && r.time ? formatTime(r.time) : ''}</td>
                      <td class="bac-mono">{r && !r.skipped && tests.length ? `${passedTests}/${tests.length}` : r && !r.skipped ? 'none' : ''}</td>
                    </tr>
                    {expandable && open[item.id] && (
                      <tr key={`${item.id}-detail`} class="bac-run-detail">
                        <td />
                        <td colSpan={4}>
                          {r.error && <p class="bac-run-error">{r.error}</p>}
                          <ul class="bac-test-list">
                            {tests
                              .filter((t) => !t.pass)
                              .map((t) => (
                                <li key={t.id} class="is-fail">
                                  <span class="bac-test-icon" aria-hidden="true">✗</span> {t.message}
                                </li>
                              ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}
