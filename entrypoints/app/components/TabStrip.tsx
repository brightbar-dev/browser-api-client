import { useRef } from 'preact/hooks';
import { isTabDirty, tabTitle, type WorkspaceTab } from '@/utils/workspace';
import { activateTab, closeTab, moveTab, newTab, useApp } from '../store';
import { cancelSend } from '../send';
import { IconClose, IconPlus } from './icons';

function requestClose(tab: WorkspaceTab) {
  if (isTabDirty(tab) && !window.confirm(`Close “${tabTitle(tab)}”? Its unsaved changes will be discarded.`)) return;
  closeTab(tab.id, cancelSend);
}

export function TabStrip() {
  const tabs = useApp((s) => s.workspace.tabs);
  const activeId = useApp((s) => s.workspace.activeTabId);
  const runs = useApp((s) => s.runs);
  const dragFrom = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (!tab) return;
    activateTab(tab.id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"]`)?.focus());
  };

  return (
    <div class="bac-tabstrip">
      <div role="tablist" aria-label="Open requests" class="bac-tabstrip-list" ref={listRef}>
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const title = tabTitle(tab);
          const sending = runs[tab.id]?.state === 'sending';
          const dirty = isTabDirty(tab);
          return (
            <div
              key={tab.id}
              class={`bac-reqtab${active ? ' is-active' : ''}`}
              draggable
              onDragStart={(e) => {
                dragFrom.current = index;
                e.dataTransfer?.setData('text/plain', tab.id);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom.current !== null) moveTab(dragFrom.current, index);
                dragFrom.current = null;
              }}
            >
              <button
                type="button"
                role="tab"
                data-tab-id={tab.id}
                aria-selected={active}
                aria-controls="bac-bench"
                tabIndex={active ? 0 : -1}
                class="bac-reqtab-main"
                title={tab.request.url || title}
                onClick={() => activateTab(tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) requestClose(tab);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') focusTab(index + 1);
                  else if (e.key === 'ArrowLeft') focusTab(index - 1);
                  else if (e.key === 'Home') focusTab(0);
                  else if (e.key === 'End') focusTab(tabs.length - 1);
                  else if (e.key === 'Delete') requestClose(tab);
                  else return;
                  e.preventDefault();
                }}
              >
                <span class={`bac-method-tag m-${tab.request.method.toLowerCase()}`}>{tab.request.method}</span>
                <span class="bac-reqtab-title">{title}</span>
                {sending ? (
                  <span class="bac-spinner" role="img" aria-label="Sending" />
                ) : dirty ? (
                  <span class="bac-dirty-dot" role="img" aria-label="Unsaved changes" title="Unsaved changes" />
                ) : null}
              </button>
              <button
                type="button"
                class="bac-reqtab-close"
                tabIndex={-1}
                aria-label={`Close ${title}`}
                title="Close tab"
                onClick={() => requestClose(tab)}
              >
                <IconClose />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" class="bac-icon-btn bac-newtab" aria-label="New request tab" title="New request tab" onClick={newTab}>
        <IconPlus />
      </button>
    </div>
  );
}
