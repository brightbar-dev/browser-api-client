import { useEffect, useRef } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { getState, newTab, openDialog, setActiveEnv, setLayout, useApp } from '../store';
import { requestClose } from './TabStrip';
import { createEnvironment, requestSave } from '../library';
import { Dialogs, Toast } from './Dialogs';
import { cancelSend, sendTab } from '../send';
import { Sidebar } from './Sidebar';
import { TabStrip } from './TabStrip';
import { RequestEditor } from './RequestEditor';
import { ResponsePane } from './ResponsePane';
import { Splitter } from './Splitter';
import { IconSettings, IconSidebar } from './icons';
import { t } from '@/utils/i18n';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function useTheme() {
  const theme = useApp((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'auto' ? (mq.matches ? 'dark' : 'light') : theme;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function focusUrl() {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('input.bac-url-input');
    input?.focus();
    input?.select();
  });
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { activeTabId } = getState().workspace;
      const mod = e.metaKey || e.ctrlKey;
      // Browsers keep Cmd/Ctrl+T, W and L for themselves; Alt works everywhere.
      const appKey = (mod || e.altKey) && !e.shiftKey && !(mod && e.altKey);
      if (getState().dialog) return;
      if (appKey && e.code === 'KeyT') {
        e.preventDefault();
        newTab();
        focusUrl();
        return;
      }
      if (appKey && e.code === 'KeyW') {
        e.preventDefault();
        const tab = getState().workspace.tabs.find((t) => t.id === activeTabId);
        if (tab) requestClose(tab);
        return;
      }
      if (appKey && e.code === 'KeyL') {
        e.preventDefault();
        focusUrl();
        return;
      }
      if (e.key === '?' && !mod && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        openDialog({ type: 'shortcuts' });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void sendTab(activeTabId);
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        requestSave(activeTabId);
      } else if (e.key === 'Escape' && ['sending', 'streaming'].includes(getState().runs[activeTabId]?.state ?? '')) {
        cancelSend(activeTabId);
      }
    };
    // Leaving the page kills in-flight requests, so ask first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.values(getState().runs).some((r) => r.state === 'sending' || r.state === 'streaming')) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
}

function Header() {
  const environments = useApp((s) => s.environments);
  const activeEnvId = useApp((s) => s.activeEnvId);
  const sidebarOpen = useApp((s) => s.layout.sidebarOpen);
  return (
    <header class="bac-header">
      <button
        type="button"
        class="bac-icon-btn"
        aria-label={sidebarOpen ? t('headerHideSidebar') : t('headerShowSidebar')}
        aria-pressed={sidebarOpen}
        title={sidebarOpen ? t('headerHideSidebar') : t('headerShowSidebar')}
        onClick={() => setLayout({ sidebarOpen: !sidebarOpen })}
      >
        <IconSidebar />
      </button>
      <div class="bac-brand">
        <img src="/icon-bac.svg" alt="" width={20} height={20} />
        <span>{t('appName')}</span>
      </div>
      <div class="bac-spacer" />
      <label class="bac-env-picker">
        <span class="bac-env-label">{t('headerEnvironment')}</span>
        <select
          class="bac-select"
          value={activeEnvId ?? ''}
          onChange={(e) => setActiveEnv(e.currentTarget.value || null)}
        >
          <option value="">{t('headerNoEnvironment')}</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        class="bac-icon-btn"
        aria-label={activeEnvId ? t('headerEditEnvLabel') : t('headerCreateEnvLabel')}
        title={activeEnvId ? t('headerEditEnvTitle') : t('envNew')}
        onClick={() => openDialog({ type: 'environment', envId: activeEnvId ?? createEnvironment(t('envDefaultName')).id })}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" />
        </svg>
      </button>
      <button type="button" class="bac-btn bac-btn-ghost" onClick={() => openDialog({ type: 'import' })}>
        {t('importButton')}
      </button>
      <button type="button" class="bac-icon-btn" aria-label={t('shortcutsTitle')} title={t('headerShortcutsTooltip')} onClick={() => openDialog({ type: 'shortcuts' })}>
        <span aria-hidden="true" class="bac-kbd-icon">?</span>
      </button>
      <button type="button" class="bac-btn bac-btn-ghost" onClick={() => browser.runtime.openOptionsPage()}>
        <IconSettings /> {t('headerSettings')}
      </button>
    </header>
  );
}

function Workbench() {
  const tabId = useApp((s) => s.workspace.activeTabId);
  const fraction = useApp((s) => s.layout.requestFraction);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      class="bac-bench"
      id="bac-bench"
      ref={ref}
      style={{ gridTemplateRows: `minmax(140px, ${fraction}fr) auto minmax(140px, ${1 - fraction}fr)` }}
    >
      <RequestEditor key={tabId} tabId={tabId} />
      <Splitter
        orientation="horizontal"
        label={t('benchResizeLabel')}
        value={Math.round(fraction * 100)}
        min={15}
        max={85}
        onMove={(clientY) => {
          const rect = ref.current!.getBoundingClientRect();
          setLayout({ requestFraction: clamp((clientY - rect.top) / rect.height, 0.15, 0.85) });
        }}
        onStep={(dir) => setLayout({ requestFraction: clamp(fraction + dir * 0.05, 0.15, 0.85) })}
      />
      <ResponsePane key={tabId} tabId={tabId} />
    </div>
  );
}

export function App() {
  const ready = useApp((s) => s.ready);
  const sidebarOpen = useApp((s) => s.layout.sidebarOpen);
  const sidebarWidth = useApp((s) => s.layout.sidebarWidth);
  useTheme();
  useShortcuts();

  if (!ready) return <div class="bac-boot" aria-busy="true" />;
  return (
    <div class="bac-app">
      <Header />
      <div class="bac-main" style={{ gridTemplateColumns: sidebarOpen ? `${sidebarWidth}px minmax(0, 1fr)` : 'minmax(0, 1fr)' }}>
        {sidebarOpen && <Sidebar />}
        <main class="bac-work">
          <TabStrip />
          <Workbench />
        </main>
      </div>
      <Dialogs />
      <Toast />
    </div>
  );
}
