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
import { t, tParts } from '@/utils/i18n';

const PANELS: Array<{ id: SidebarPanel; label: string }> = [
  { id: 'history', label: t('sidebarHistory') },
  { id: 'collections', label: t('sidebarCollections') },
  { id: 'environments', label: t('sidebarEnvironments') },
];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function Sidebar() {
  const panel = useApp((s) => s.layout.sidebarPanel);
  const width = useApp((s) => s.layout.sidebarWidth);
  return (
    <aside class="bac-sidebar" aria-label={t('sidebarLabel')}>
      <div role="tablist" aria-label={t('sidebarSectionsLabel')} class="bac-side-tabs">
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
        label={t('sidebarResize')}
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
  { id: 'all', label: t('historyFilterStatusAll') },
  { id: '2xx', label: '2xx' },
  { id: '3xx', label: '3xx' },
  { id: '4xx', label: '4xx' },
  { id: '5xx', label: '5xx' },
  { id: 'error', label: t('historyFilterFailed') },
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
    return <Empty title={t('historyEmptyTitle')}>{t('historyEmptyHint')}</Empty>;
  }
  return (
    <>
      <div class="bac-side-toolbar bac-side-toolbar-stack">
        <input type="search" class="bac-input" placeholder={t('historySearchPlaceholder')} aria-label={t('historySearchLabel')} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <div class="bac-row">
          <select class="bac-select" aria-label={t('historyFilterMethodLabel')} value={method} onChange={(e) => setMethod(e.currentTarget.value)}>
            <option value="all">{t('historyFilterMethodAll')}</option>
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select class="bac-select" aria-label={t('historyFilterStatusLabel')} value={status} onChange={(e) => setStatus(e.currentTarget.value as StatusFilter)}>
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
              if (window.confirm(t('historyClearConfirm'))) void clearHistory();
            }}
          >
            {t('commonClear')}
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
      {!groups.length && <p class="bac-muted bac-pad">{t('historyNoMatches')}</p>}
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
        title={`${request.method} ${request.url}\n${response.status ? `${response.status} ${response.statusText}` : response.statusText} · ${t('commonMs', response.time)}`}
        onClick={() => openRequest({ ...request, id: generateId() })}
      >
        <span class={`bac-method-tag m-${request.method.toLowerCase()}`}>{request.method}</span>
        <span class="bac-list-main bac-mono">{request.name && request.name !== 'New Request' ? request.name : displayUrl(request.url) || t('historyNoUrl')}</span>
        <span class={`bac-status-mini s-${statusColor(response.status)}`}>{response.status || t('historyErrorStatus')}</span>
        <span class="bac-list-meta">{timeOf(entry.timestamp)}</span>
      </button>
      <button type="button" class="bac-icon-btn bac-row-action" aria-label={t('historyDeleteLabel', `${request.method} ${displayUrl(request.url)}`)} title={t('commonDelete')} onClick={() => void deleteHistory([entry.id])}>
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
    const c = createCollection(t('collectionDefaultName'));
    setRenaming(`c:${c.id}`);
  };

  if (!collections.length) {
    return (
      <Empty
        title={t('collectionsEmptyTitle')}
        actions={
          <>
            <button type="button" class="bac-btn bac-btn-small" onClick={newCollection}>
              {t('collectionNew')}
            </button>
            <button type="button" class="bac-btn bac-btn-small" onClick={() => openDialog({ type: 'import' })}>
              {t('collectionsImportEllipsis')}
            </button>
          </>
        }
      >
        {tParts('collectionsEmptyHint', <kbd>{isMac ? '⌘S' : 'Ctrl+S'}</kbd>)}
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
              label={t('requestNameLabel')}
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
            label={t('commonActionsFor', r.name)}
            items={[
              { label: t('commonOpen'), onSelect: () => openFromCollection(c.id, r.id) },
              { label: t('commonRename'), onSelect: () => setRenaming(key) },
              { label: t('commonDuplicate'), onSelect: () => updateCollection(c.id, (x) => col.duplicateRequestAnywhere(x, r.id).collection) },
              ...(index > 0 ? [{ label: t('commonMoveUp'), onSelect: () => move(-1) }] : []),
              ...(index < list.length - 1 ? [{ label: t('commonMoveDown'), onSelect: () => move(1) }] : []),
              {
                label: t('commonDelete'),
                danger: true,
                onSelect: () => {
                  if (window.confirm(t('collectionDeleteRequestConfirm', r.name, c.name))) updateCollection(c.id, (x) => col.removeRequestAnywhere(x, r.id));
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
        <input type="search" class="bac-input" placeholder={t('collectionsSearch')} aria-label={t('collectionsSearch')} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <button type="button" class="bac-icon-btn" aria-label={t('collectionNew')} title={t('collectionNew')} onClick={newCollection}>
          <IconPlus />
        </button>
        <button type="button" class="bac-btn bac-btn-small" onClick={() => openDialog({ type: 'import' })}>
          {t('importButton')}
        </button>
      </div>
      <ul class="bac-tree" role="tree" aria-label={t('sidebarCollections')}>
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
                    label={t('collectionNameLabel')}
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
                  label={t('commonActionsFor', c.name)}
                  items={[
                    { label: t('collectionRun'), onSelect: () => openDialog({ type: 'runner', collectionId: c.id, folderId: null }) },
                    { label: t('commonRename'), onSelect: () => setRenaming(key) },
                    {
                      label: t('folderNew'),
                      onSelect: () => {
                        const { collection, folder } = col.addFolder(full, t('folderDefaultName'));
                        updateCollection(c.id, () => collection);
                        setCollapsed({ ...collapsed, [key]: false });
                        setRenaming(`f:${c.id}:${folder.id}`);
                      },
                    },
                    { label: t('commonDuplicate'), onSelect: () => duplicateCollection(c.id) },
                    { label: t('collectionExportPostman'), onSelect: () => downloadText(`${safeFileName(c.name, 'collection')}.postman_collection.json`, exportToPostman(full)) },
                    ...(ci > 0 && !searching ? [{ label: t('commonMoveUp'), onSelect: () => moveCollection(c.id, ci - 1) }] : []),
                    ...(ci < tree.length - 1 && !searching ? [{ label: t('commonMoveDown'), onSelect: () => moveCollection(c.id, ci + 1) }] : []),
                    {
                      label: t('commonDelete'),
                      danger: true,
                      onSelect: () => {
                        if (window.confirm(t('collectionDeleteConfirm', c.name, col.countRequests(full)))) deleteCollection(c.id);
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
                              label={t('folderNameLabel')}
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
                            label={t('folderActionsFor', f.name)}
                            items={[
                              { label: t('folderRun'), onSelect: () => openDialog({ type: 'runner', collectionId: c.id, folderId: f.id }) },
                              { label: t('commonRename'), onSelect: () => setRenaming(fkey) },
                              { label: t('commonDuplicate'), onSelect: () => updateCollection(c.id, (x) => col.duplicateFolder(x, f.id)) },
                              ...(fi > 0 ? [{ label: t('commonMoveUp'), onSelect: () => moveFolder(-1) }] : []),
                              ...(fi < (c.folders?.length ?? 0) - 1 ? [{ label: t('commonMoveDown'), onSelect: () => moveFolder(1) }] : []),
                              {
                                label: t('commonDelete'),
                                danger: true,
                                onSelect: () => {
                                  if (window.confirm(t('folderDeleteConfirm', f.name, f.requests.length))) updateCollection(c.id, (x) => col.deleteFolder(x, f.id));
                                },
                              },
                            ]}
                          />
                        </div>
                        {fexpanded && (
                          <ul role="group">
                            {f.requests.map((_, i) => requestRow(c, f, i))}
                            {!f.requests.length && <li role="none" class="bac-tree-empty">{t('folderEmpty')}</li>}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                  {!c.requests.length && !(c.folders ?? []).length && <li role="none" class="bac-tree-empty">{t('collectionEmpty', isMac ? '⌘S' : 'Ctrl+S')}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {searching && !tree.length && <p class="bac-muted bac-pad">{t('collectionsNoMatch', query)}</p>}
    </>
  );
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

// --- environments ---

function EnvironmentsPanel() {
  const environments = useApp((s) => s.environments);
  const activeEnvId = useApp((s) => s.activeEnvId);
  const create = () => {
    const env = createEnvironment(t('envDefaultName'));
    openDialog({ type: 'environment', envId: env.id });
  };
  if (!environments.length) {
    return (
      <Empty
        title={t('envsEmptyTitle')}
        actions={
          <button type="button" class="bac-btn bac-btn-small" onClick={create}>
            {t('envNew')}
          </button>
        }
      >
        {t('envsEmptyHint', '{{variables}}')}
      </Empty>
    );
  }
  return (
    <>
      <div class="bac-side-toolbar">
        <span class="bac-muted bac-small bac-grow">{t('envsHint')}</span>
        <button type="button" class="bac-icon-btn" aria-label={t('envNew')} title={t('envNew')} onClick={create}>
          <IconPlus />
        </button>
      </div>
      <ul class="bac-list" aria-label={t('sidebarEnvironments')}>
        {environments.map((env) => {
          const active = env.id === activeEnvId;
          const count = env.variables.filter((v) => v.key).length;
          return (
            <li key={env.id} class={`bac-tree-row bac-row-hover${active ? ' is-selected' : ''}`}>
              <button
                type="button"
                class={`bac-env-dot${active ? ' is-active' : ''}`}
                aria-label={active ? t('envActiveTurnOff', env.name) : t('envUseNamed', env.name)}
                aria-pressed={active}
                title={active ? t('envActiveTitle') : t('envUse')}
                onClick={() => setActiveEnv(active ? null : env.id)}
              />
              <button type="button" class="bac-tree-main" onClick={() => openDialog({ type: 'environment', envId: env.id })}>
                <span class="bac-list-main">{env.name}</span>
                <span class="bac-list-meta">
                  {count === 1 ? t('envVariableCountOne', count) : t('envVariableCountOther', count)}
                </span>
              </button>
              <Menu
                label={t('commonActionsFor', env.name)}
                items={[
                  { label: t('commonEdit'), onSelect: () => openDialog({ type: 'environment', envId: env.id }) },
                  { label: active ? t('envStopUsing') : t('envUse'), onSelect: () => setActiveEnv(active ? null : env.id) },
                  { label: t('commonDuplicate'), onSelect: () => duplicateEnvironmentById(env.id) },
                  { label: t('envExportPostman'), onSelect: () => downloadText(`${safeFileName(env.name, 'environment')}.postman_environment.json`, exportEnvironmentToPostman(env)) },
                  {
                    label: t('commonDelete'),
                    danger: true,
                    onSelect: () => {
                      if (window.confirm(t('envDeleteConfirm', env.name))) deleteEnvironment(env.id);
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
