import { render } from 'preact';
import { browser } from 'wxt/browser';
import { App } from './components/App';
import { loadApp } from './store';

// Firefox has no runtime.getContexts, so the toolbar button asks an open app page to focus itself.
browser.runtime.onMessage.addListener((msg: { action?: string }) => {
  if (msg?.action !== 'focusApp') return undefined;
  return (async () => {
    const tab = await browser.tabs.getCurrent();
    if (tab?.id === undefined) return false;
    await browser.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
    return true;
  })();
});

render(<App />, document.getElementById('root')!);

loadApp().catch((err) => {
  console.error('Could not load the workspace:', err);
  document.getElementById('root')!.textContent = `Browser API Client could not load its saved data: ${(err as Error).message}`;
});
