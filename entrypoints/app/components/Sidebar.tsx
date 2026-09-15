import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { generateId, statusColor } from '@/utils/request';
import { filterByUrl, formatTimestamp } from '@/utils/history';
import { clearHistory, openRequest, setActiveEnv, setLayout, useApp } from '../store';
import type { SidebarPanel } from '../types';
import { Splitter } from './Splitter';
import { IconChevronRight } from './icons';

const PANELS: Array<{ id: SidebarPanel; label: string }> = [
  { id: 'history', label: 'History' },
  { id: 'collections', label: 'Collections' },
  { id: 'environments', label: 'Environments' },
];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function Sidebar() {
  const panel = useApp((s) => s.layout.sidebarPanel);
  const width = useApp((s) => s.layout.sidebarWidth);
  return (
    <aside class="bac-sidebar" aria-label="Library">
      <div role="tablist" aria-label="Library sections" class="bac-side-tabs">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            id={`bac-side-tab-${p.id}`}
            aria-selected={panel === p.id}
            aria-controls="bac-side-panel"
            class={`bac-side-tab${panel === p.id ? ' is-active' : ''}`}
            onClick={() => setLayout({ sidebarPanel: p.id })}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div class="bac-side-panel" role="tabpanel" id="bac-side-panel" aria-labelledby={`bac-side-tab-${panel}`}>
        {panel === 'history' && <HistoryPanel />}
        {panel === 'collections' && <CollectionsPanel />}
        {panel === 'environments' && <EnvironmentsPanel />}
      </div>
      <Splitter
        orientation="vertical"
        label="Resize sidebar"
        value={width}
        min={200}
        max={520}
        onMove={(x) => setLayout({ sidebarWidth: clamp(x, 200, 520) })}
        onStep={(dir) => setLayout({ sidebarWidth: clamp(width + dir * 24, 200, 520) })}
      />
    </aside>
  );
}

function Empty({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="bac-side-empty">
      <p class="bac-empty-title">{title}</p>
      <p class="bac-muted">{children}</p>
    </div>
  );
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function HistoryPanel() {
  const history = useApp((s) => s.history);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => (query ? filterByUrl(history, query) : history), [history, query]);

  if (!history.length) {
    return <Empty title="No history yet">Every request you send is kept here, newest first, so you can open it again.</Empty>;
  }
  return (
    <>
      <div class="bac-side-toolbar">
        <input type="search" class="bac-input" placeholder="Filter by URL" aria-label="Filter history by URL" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <button
          type="button"
          class="bac-btn bac-btn-small"
          onClick={() => {
            if (window.confirm('Clear all request history?')) void clearHistory();
          }}
        >
          Clear
        </button>
      </div>
      <ul class="bac-list" aria-label="Request history">
        {shown.map((entry) => (
          <li key={entry.id}>
            <button type="button" class="bac-list-item" title={`Open ${entry.request.method} ${entry.request.url}`} onClick={() => openRequest({ ...entry.request, id: generateId() })}>
              <span class={`bac-method-tag m-${entry.request.method.toLowerCase()}`}>{entry.request.method}</span>
              <span class="bac-list-main bac-mono">{displayUrl(entry.request.url) || '(no URL)'}</span>
              <span class={`bac-status-mini s-${statusColor(entry.response.status)}`}>{entry.response.status || 'ERR'}</span>
              <span class="bac-list-meta">{formatTimestamp(entry.timestamp)}</span>
            </button>
          </li>
        ))}
      </ul>
      {!shown.length && <p class="bac-muted bac-pad">Nothing matches “{query}”.</p>}
    </>
  );
}

function CollectionsPanel() {
  const collections = useApp((s) => s.collections);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!collections.length) {
    return <Empty title="No collections yet">Collections group saved requests. Restore a backup from Settings to bring yours in.</Empty>;
  }
  return (
    <ul class="bac-list" role="tree" aria-label="Collections">
      {collections.map((c) => {
        const expanded = open[c.id] ?? true;
        return (
          <li key={c.id} role="treeitem" aria-expanded={expanded}>
            <button type="button" class="bac-list-item bac-tree-head" onClick={() => setOpen({ ...open, [c.id]: !expanded })}>
              <span class={`bac-jt-chevron${expanded ? ' is-open' : ''}`}>
                <IconChevronRight />
              </span>
              <span class="bac-list-main">{c.name}</span>
              <span class="bac-list-meta">{c.requests.length}</span>
            </button>
            {expanded && (
              <ul role="group">
                {c.requests.map((r) => (
                  <li key={r.id} role="treeitem">
                    <button type="button" class="bac-list-item bac-tree-leaf" onClick={() => openRequest(r, { collectionId: c.id, requestId: r.id })}>
                      <span class={`bac-method-tag m-${r.method.toLowerCase()}`}>{r.method}</span>
                      <span class="bac-list-main">{r.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EnvironmentsPanel() {
  const environments = useApp((s) => s.environments);
  const activeEnvId = useApp((s) => s.activeEnvId);
  if (!environments.length) {
    return <Empty title="No environments yet">Environments hold {'{{variables}}'} such as a base URL or token, so one request works against dev, staging and production.</Empty>;
  }
  return (
    <ul class="bac-list" aria-label="Environments">
      {environments.map((env) => (
        <li key={env.id}>
          <button type="button" class={`bac-list-item${env.id === activeEnvId ? ' is-selected' : ''}`} aria-pressed={env.id === activeEnvId} onClick={() => setActiveEnv(env.id === activeEnvId ? null : env.id)}>
            <span class="bac-list-main">{env.name}</span>
            <span class="bac-list-meta">{env.id === activeEnvId ? 'Active' : `${env.variables.filter((v) => v.key).length} vars`}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
