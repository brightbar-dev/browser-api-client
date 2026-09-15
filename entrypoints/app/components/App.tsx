import { useEffect, useRef } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { getState, setActiveEnv, setLayout, useApp } from '../store';
import { cancelSend, sendTab } from '../send';
import { Sidebar } from './Sidebar';
import { TabStrip } from './TabStrip';
import { RequestEditor } from './RequestEditor';
import { ResponsePane } from './ResponsePane';
import { Splitter } from './Splitter';
import { IconSettings, IconSidebar } from './icons';

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

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { activeTabId } = getState().workspace;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void sendTab(activeTabId);
      } else if (e.key === 'Escape' && getState().runs[activeTabId]?.state === 'sending') {
        cancelSend(activeTabId);
      }
    };
    // Leaving the page kills in-flight requests, so ask first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.values(getState().runs).some((r) => r.state === 'sending')) e.preventDefault();
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
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-pressed={sidebarOpen}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        onClick={() => setLayout({ sidebarOpen: !sidebarOpen })}
      >
        <IconSidebar />
      </button>
      <div class="bac-brand">
        <img src="/icon-bac.svg" alt="" width={20} height={20} />
        <span>Browser API Client</span>
      </div>
      <div class="bac-spacer" />
      <label class="bac-env-picker">
        <span class="bac-env-label">Environment</span>
        <select
          class="bac-select"
          value={activeEnvId ?? ''}
          onChange={(e) => setActiveEnv(e.currentTarget.value || null)}
        >
          <option value="">No environment</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" class="bac-btn bac-btn-ghost" onClick={() => browser.runtime.openOptionsPage()}>
        <IconSettings /> Settings
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
        label="Resize request and response"
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
    </div>
  );
}
