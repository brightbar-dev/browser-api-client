import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { generateId, statusColor } from '@/utils/request';
import type { HistoryEntry, StatusFilter } from '@/utils/history';
import { filterHistory, groupByDay } from '@/utils/history';
import type { Collection, CollectionFolder } from '@/utils/collections';
import * as col from '@/utils/collections';
import { exportEnvironmentToPostman, exportToPostman } from '@/utils/import-export';
import { HTTP_METHODS } from '@/utils/request';
import { activeTab } from '@/utils/workspace';
import { clearHistory, deleteHistory, openDialog, openRequest, setActiveEnv, setLayout, useApp } from '../store';
import {
  createCollection,
  createEnvironment,
  deleteCollection,
  deleteEnvironment,
  duplicateCollection,
  duplicateEnvironmentById,
  moveCollection,
  moveRequestAcross,
  openFromCollection,
  updateCollection,
} from '../library';
import { downloadText, safeFileName } from '../download';
import type { SidebarPanel } from '../types';
import { Splitter } from './Splitter';
import { Menu } from './Menu';
import { IconChevronRight, IconClose, IconPlus } from './icons';

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

function Empty({ title, children, actions }: { title: string; children: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class="bac-side-empty">
      <p class="bac-empty-title">{title}</p>
      <p class="bac-muted">{children}</p>
      {actions && <div class="bac-row">{actions}</div>}
    </div>
  );
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function RenameInput({ value, label, onDone }: { value: string; label: string; onDone: (next: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next === null ? null : next.trim() || value);
  };
  return (
    <input
      ref={ref}
      class="bac-input bac-rename"
      aria-label={label}
      defaultValue={value}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
        e.stopPropagation();
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

// --- history ---

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'Any status' },
  { id: '2xx', label: '2xx' },
  { id: '3xx', label: '3xx' },
  { id: '4xx', label: '4xx' },
  { id: '5xx', label: '5xx' },
  { id: 'error', label: 'Failed' },
];

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function HistoryPanel() {
  const history = useApp((s) => s.history);
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const groups = useMemo(() => groupByDay(filterHistory(history, { query, method, status })), [history, query, method, status]);

  if (!history.length) {
    return <Empty title="No history yet">Every request you send is kept here, newest first, so you can open it again.</Empty>;
  }
  return (
    <>
      <div class="bac-side-toolbar bac-side-toolbar-stack">
        <input type="search" class="bac-input" placeholder="Search URL or name" aria-label="Search history" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <div class="bac-row">
          <select class="bac-select" aria-label="Filter by method" value={method} onChange={(e) => setMethod(e.currentTarget.value)}>
            <option value="all">Any method</option>
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select class="bac-select" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.currentTarget.value as StatusFilter)}>
            {STATUS_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
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
      </div>
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h3 class="bac-group-head">{g.label}</h3>
          <ul class="bac-list">
            {g.entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
      {!groups.length && <p class="bac-muted bac-pad">No requests match these filters.</p>}
    </>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const { request, response } = entry;
  return (
    <li class="bac-row-hover">
      <button
        type="button"
        class="bac-list-item"
        title={`${request.method} ${request.url}\n${response.status ? `${response.status} ${response.statusText}` : response.statusText} · ${response.time} ms`}
        onClick={() => openRequest({ ...request, id: generateId() })}
      >
        <span class={`bac-method-tag m-${request.method.toLowerCase()}`}>{request.method}</span>
        <span class="bac-list-main bac-mono">{request.name && request.name !== 'New Request' ? request.name : displayUrl(request.url) || '(no URL)'}</span>
        <span class={`bac-status-mini s-${statusColor(response.status)}`}>{response.status || 'ERR'}</span>
        <span class="bac-list-meta">{timeOf(entry.timestamp)}</span>
      </button>
      <button type="button" class="bac-icon-btn bac-row-action" aria-label={`Delete ${request.method} ${displayUrl(request.url)} from history`} title="Delete" onClick={() => void deleteHistory([entry.id])}>
        <IconClose />
      </button>
    </li>
  );
}

// --- collections ---

type DragItem = { collectionId: string; requestId: string };

function CollectionsPanel() {
  const collections = useApp((s) => s.collections);
  const activeSource = useApp((s) => activeTab(s.workspace).source);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const drag = useRef<DragItem | null>(null);
  const tree = useMemo(() => col.filterCollectionTree(collections, query), [collections, query]);
  const searching = query.trim() !== '';

  const toggle = (key: string) => setCollapsed({ ...collapsed, [key]: !collapsed[key] });
  const newCollection = () => {
    const c = createCollection('New collection');
    setRenaming(`c:${c.id}`);
  };

  if (!collections.length) {
    return (
      <Empty
        title="No collections yet"
        actions={
          <>
            <button type="button" class="bac-btn bac-btn-small" onClick={newCollection}>
              New collection
            </button>
            <button type="button" class="bac-btn bac-btn-small" onClick={() => openDialog({ type: 'import' })}>
              Import…
            </button>
          </>
        }
      >
        Save requests into collections with <kbd>{isMac ? '⌘S' : 'Ctrl+S'}</kbd>, or import a Postman collection, an OpenAPI spec or a cURL command.
      </Empty>
    );
  }

  const dropProps = (key: string, onDropItem: (item: DragItem) => void) =>
    searching
      ? {}
      : {
          onDragOver: (e: DragEvent) => {
            if (!drag.current) return;
            e.preventDefault();
            if (dropKey !== key) setDropKey(key);
          },
          onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setDropKey(null);
            if (drag.current) onDropItem(drag.current);
            drag.current = null;
          },
        };

  const requestRow = (c: Collection, folder: CollectionFolder | null, index: number) => {
    const list = folder ? folder.requests : c.requests;
    const r = list[index]!;
    const key = `r:${c.id}:${r.id}`;
    const active = activeSource?.collectionId === c.id && activeSource.requestId === r.id;
    const move = (dir: -1 | 1) => updateCollection(c.id, (x) => col.moveRequestTo(x, r.id, { folderId: folder?.id ?? null, index: index + dir }));
    return (
      <li key={r.id} role="treeitem" aria-selected={active}>
        <div
          class={`bac-tree-row bac-row-hover${active ? ' is-selected' : ''}${dropKey === key ? ' is-drop' : ''}`}
          style={{ paddingLeft: folder ? 40 : 24 }}
          draggable={!searching}
          onDragStart={(e) => {
            drag.current = { collectionId: c.id, requestId: r.id };
            e.dataTransfer?.setData('text/plain', r.name);
          }}
          onDragEnd={() => {
            drag.current = null;
            setDropKey(null);
          }}
          {...dropProps(key, (item) => moveRequestAcross(item.collectionId, item.requestId, c.id, { folderId: folder?.id ?? null, index }))}
        >
          {renaming === key ? (
            <RenameInput
              value={r.name}
              label="Request name"
              onDone={(name) => {
                setRenaming(null);
                if (name !== null) updateCollection(c.id, (x) => col.upsertRequest(x, { ...r, name }, folder?.id ?? null));
              }}
            />
          ) : (
            <button
              type="button"
              class="bac-tree-main"
              title={`${r.method} ${r.url}`}
              onClick={() => openFromCollection(c.id, r.id)}
              onKeyDown={(e) => {
                if (e.altKey && e.key === 'ArrowUp') move(-1);
                else if (e.altKey && e.key === 'ArrowDown') move(1);
                else if (e.key === 'F2') setRenaming(key);
                else return;
                e.preventDefault();
              }}
            >
              <span class={`bac-method-tag m-${r.method.toLowerCase()}`}>{r.method}</span>
              <span class="bac-list-main">{r.name}</span>
            </button>
          )}
          <Menu
            label={`Actions for ${r.name}`}
            items={[
              { label: 'Open', onSelect: () => openFromCollection(c.id, r.id) },
              { label: 'Rename', onSelect: () => setRenaming(key) },
              { label: 'Duplicate', onSelect: () => updateCollection(c.id, (x) => col.duplicateRequestAnywhere(x, r.id).collection) },
              ...(index > 0 ? [{ label: 'Move up', onSelect: () => move(-1) }] : []),
              ...(index < list.length - 1 ? [{ label: 'Move down', onSelect: () => move(1) }] : []),
              {
                label: 'Delete',
                danger: true,
                onSelect: () => {
                  if (window.confirm(`Delete “${r.name}” from “${c.name}”?`)) updateCollection(c.id, (x) => col.removeRequestAnywhere(x, r.id));
                },
              },
            ]}
          />
        </div>
      </li>
    );
  };

  return (
    <>
      <div class="bac-side-toolbar">
        <input type="search" class="bac-input" placeholder="Search collections" aria-label="Search collections" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <button type="button" class="bac-icon-btn" aria-label="New collection" title="New collection" onClick={newCollection}>
          <IconPlus />
        </button>
        <button type="button" class="bac-btn bac-btn-small" onClick={() => openDialog({ type: 'import' })}>
          Import
        </button>
      </div>
      <ul class="bac-tree" role="tree" aria-label="Collections">
        {tree.map((c, ci) => {
          const key = `c:${c.id}`;
          const expanded = searching || !collapsed[key];
          const full = collections.find((x) => x.id === c.id) ?? c;
          return (
            <li key={c.id} role="treeitem" aria-expanded={expanded}>
              <div class={`bac-tree-row bac-tree-collection bac-row-hover${dropKey === key ? ' is-drop' : ''}`} {...dropProps(key, (item) => moveRequestAcross(item.collectionId, item.requestId, c.id, { folderId: null, index: full.requests.length }))}>
                {renaming === key ? (
                  <RenameInput
                    value={c.name}
                    label="Collection name"
                    onDone={(name) => {
                      setRenaming(null);
                      if (name !== null) updateCollection(c.id, (x) => col.renameCollection(x, name));
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    class="bac-tree-main"
                    onClick={() => toggle(key)}
                    onKeyDown={(e) => {
                      if (e.key === 'F2') setRenaming(key);
                      else if (e.altKey && e.key === 'ArrowUp') moveCollection(c.id, ci - 1);
                      else if (e.altKey && e.key === 'ArrowDown') moveCollection(c.id, ci + 1);
                      else if (e.key === 'ArrowLeft' && expanded) toggle(key);
                      else if (e.key === 'ArrowRight' && !expanded) toggle(key);
                      else return;
                      e.preventDefault();
                    }}
                  >
                    <span class={`bac-jt-chevron${expanded ? ' is-open' : ''}`}>
                      <IconChevronRight />
                    </span>
                    <span class="bac-list-main bac-strong">{c.name}</span>
                    <span class="bac-list-meta">{col.countRequests(full)}</span>
                  </button>
                )}
                <Menu
                  label={`Actions for ${c.name}`}
                  items={[
                    { label: 'Rename', onSelect: () => setRenaming(key) },
                    {
                      label: 'New folder',
                      onSelect: () => {
                        const { collection, folder } = col.addFolder(full, 'New folder');
                        updateCollection(c.id, () => collection);
                        setCollapsed({ ...collapsed, [key]: false });
                        setRenaming(`f:${c.id}:${folder.id}`);
                      },
                    },
                    { label: 'Duplicate', onSelect: () => duplicateCollection(c.id) },
                    { label: 'Export as Postman v2.1', onSelect: () => downloadText(`${safeFileName(c.name, 'collection')}.postman_collection.json`, exportToPostman(full)) },
                    ...(ci > 0 && !searching ? [{ label: 'Move up', onSelect: () => moveCollection(c.id, ci - 1) }] : []),
                    ...(ci < tree.length - 1 && !searching ? [{ label: 'Move down', onSelect: () => moveCollection(c.id, ci + 1) }] : []),
                    {
                      label: 'Delete',
                      danger: true,
                      onSelect: () => {
                        if (window.confirm(`Delete the collection “${c.name}” and its ${col.countRequests(full)} requests?`)) deleteCollection(c.id);
                      },
                    },
                  ]}
                />
              </div>
              {expanded && (
                <ul role="group">
                  {c.requests.map((_, i) => requestRow(c, null, i))}
                  {(c.folders ?? []).map((f, fi) => {
                    const fkey = `f:${c.id}:${f.id}`;
                    const fexpanded = searching || !collapsed[fkey];
                    const moveFolder = (dir: -1 | 1) => updateCollection(c.id, (x) => col.moveFolder(x, f.id, fi + dir));
                    return (
                      <li key={f.id} role="treeitem" aria-expanded={fexpanded}>
                        <div class={`bac-tree-row bac-row-hover${dropKey === fkey ? ' is-drop' : ''}`} style={{ paddingLeft: 20 }} {...dropProps(fkey, (item) => moveRequestAcross(item.collectionId, item.requestId, c.id, { folderId: f.id, index: f.requests.length }))}>
                          {renaming === fkey ? (
                            <RenameInput
                              value={f.name}
                              label="Folder name"
                              onDone={(name) => {
                                setRenaming(null);
                                if (name !== null) updateCollection(c.id, (x) => col.renameFolder(x, f.id, name));
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              class="bac-tree-main"
                              onClick={() => toggle(fkey)}
                              onKeyDown={(e) => {
                                if (e.key === 'F2') setRenaming(fkey);
                                else if (e.altKey && e.key === 'ArrowUp') moveFolder(-1);
                                else if (e.altKey && e.key === 'ArrowDown') moveFolder(1);
                                else if (e.key === 'ArrowLeft' && fexpanded) toggle(fkey);
                                else if (e.key === 'ArrowRight' && !fexpanded) toggle(fkey);
                                else return;
                                e.preventDefault();
                              }}
                            >
                              <span class={`bac-jt-chevron${fexpanded ? ' is-open' : ''}`}>
                                <IconChevronRight />
                              </span>
                              <svg class="bac-folder-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">
                                <path d="M1.5 4.5v8a1 1 0 001 1h11a1 1 0 001-1v-6a1 1 0 00-1-1H8L6.5 3.5h-4a1 1 0 00-1 1z" />
                              </svg>
                              <span class="bac-list-main">{f.name}</span>
                              <span class="bac-list-meta">{f.requests.length}</span>
                            </button>
                          )}
                          <Menu
                            label={`Actions for folder ${f.name}`}
                            items={[
                              { label: 'Rename', onSelect: () => setRenaming(fkey) },
                              { label: 'Duplicate', onSelect: () => updateCollection(c.id, (x) => col.duplicateFolder(x, f.id)) },
                              ...(fi > 0 ? [{ label: 'Move up', onSelect: () => moveFolder(-1) }] : []),
                              ...(fi < (c.folders?.length ?? 0) - 1 ? [{ label: 'Move down', onSelect: () => moveFolder(1) }] : []),
                              {
                                label: 'Delete',
                                danger: true,
                                onSelect: () => {
                                  if (window.confirm(`Delete the folder “${f.name}” and its ${f.requests.length} requests?`)) updateCollection(c.id, (x) => col.deleteFolder(x, f.id));
                                },
                              },
                            ]}
                          />
                        </div>
                        {fexpanded && (
                          <ul role="group">
                            {f.requests.map((_, i) => requestRow(c, f, i))}
                            {!f.requests.length && <li role="none" class="bac-tree-empty">Empty folder — drag requests here</li>}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                  {!c.requests.length && !(c.folders ?? []).length && <li role="none" class="bac-tree-empty">No requests yet — save one with {isMac ? '⌘S' : 'Ctrl+S'}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {searching && !tree.length && <p class="bac-muted bac-pad">Nothing matches “{query}”.</p>}
    </>
  );
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

// --- environments ---

function EnvironmentsPanel() {
  const environments = useApp((s) => s.environments);
  const activeEnvId = useApp((s) => s.activeEnvId);
  const create = () => {
    const env = createEnvironment('New environment');
    openDialog({ type: 'environment', envId: env.id });
  };
  if (!environments.length) {
    return (
      <Empty
        title="No environments yet"
        actions={
          <button type="button" class="bac-btn bac-btn-small" onClick={create}>
            New environment
          </button>
        }
      >
        Environments hold {'{{variables}}'} such as a base URL or a token, so one request works against dev, staging and production.
      </Empty>
    );
  }
  return (
    <>
      <div class="bac-side-toolbar">
        <span class="bac-muted bac-small bac-grow">Click one to edit it; the dot marks the active environment.</span>
        <button type="button" class="bac-icon-btn" aria-label="New environment" title="New environment" onClick={create}>
          <IconPlus />
        </button>
      </div>
      <ul class="bac-list" aria-label="Environments">
        {environments.map((env) => {
          const active = env.id === activeEnvId;
          const count = env.variables.filter((v) => v.key).length;
          return (
            <li key={env.id} class={`bac-tree-row bac-row-hover${active ? ' is-selected' : ''}`}>
              <button
                type="button"
                class={`bac-env-dot${active ? ' is-active' : ''}`}
                aria-label={active ? `${env.name} is active; turn it off` : `Use ${env.name}`}
                aria-pressed={active}
                title={active ? 'Active — click to turn off' : 'Use this environment'}
                onClick={() => setActiveEnv(active ? null : env.id)}
              />
              <button type="button" class="bac-tree-main" onClick={() => openDialog({ type: 'environment', envId: env.id })}>
                <span class="bac-list-main">{env.name}</span>
                <span class="bac-list-meta">
                  {count} variable{count === 1 ? '' : 's'}
                </span>
              </button>
              <Menu
                label={`Actions for ${env.name}`}
                items={[
                  { label: 'Edit', onSelect: () => openDialog({ type: 'environment', envId: env.id }) },
                  { label: active ? 'Stop using' : 'Use this environment', onSelect: () => setActiveEnv(active ? null : env.id) },
                  { label: 'Duplicate', onSelect: () => duplicateEnvironmentById(env.id) },
                  { label: 'Export as Postman environment', onSelect: () => downloadText(`${safeFileName(env.name, 'environment')}.postman_environment.json`, exportEnvironmentToPostman(env)) },
                  {
                    label: 'Delete',
                    danger: true,
                    onSelect: () => {
                      if (window.confirm(`Delete the environment “${env.name}”?`)) deleteEnvironment(env.id);
                    },
                  },
                ]}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
