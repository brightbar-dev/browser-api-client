import { browser } from 'wxt/browser';
import { BACKUP_KEYS, clampMaxHistory, createBackup, describeImport, mergeBackup, parseBackup, type BackupData } from '@/utils/backup';

const themeSelect = document.getElementById('theme') as HTMLSelectElement;
const maxHistoryInput = document.getElementById('max-history') as HTMLInputElement;
const clearHistoryBtn = document.getElementById('clear-history')!;
const exportDataBtn = document.getElementById('export-data')!;
const importDataBtn = document.getElementById('import-data')!;
const importFileInput = document.getElementById('import-file') as HTMLInputElement;
const dataStatus = document.getElementById('data-status')!;

function applyTheme(theme: string) {
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('bac-dark', dark);
}

function showStatus(message: string, isError = false) {
  dataStatus.textContent = message;
  dataStatus.classList.toggle('is-error', isError);
}

async function init() {
  document.getElementById('version')!.textContent = `v${browser.runtime.getManifest().version}`;
  const settings = await browser.storage.local.get(['theme', 'maxHistory']);
  themeSelect.value = typeof settings.theme === 'string' ? settings.theme : 'auto';
  maxHistoryInput.value = String(clampMaxHistory(settings.maxHistory ?? 100));
  applyTheme(themeSelect.value);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(themeSelect.value));
}

themeSelect.addEventListener('change', () => {
  applyTheme(themeSelect.value);
  browser.storage.local.set({ theme: themeSelect.value });
});

maxHistoryInput.addEventListener('change', async () => {
  const maxHistory = clampMaxHistory(maxHistoryInput.value);
  maxHistoryInput.value = String(maxHistory);
  const { history } = await browser.storage.local.get('history');
  const update: Record<string, unknown> = { maxHistory };
  if (Array.isArray(history) && history.length > maxHistory) update.history = history.slice(0, maxHistory);
  await browser.storage.local.set(update);
});

clearHistoryBtn.addEventListener('click', async () => {
  if (confirm('Clear all request history?')) {
    await browser.runtime.sendMessage({ action: 'clearHistory' });
    showStatus('History cleared.');
  }
});

exportDataBtn.addEventListener('click', async () => {
  const stored = await browser.storage.local.get([...BACKUP_KEYS]);
  const backup = createBackup(stored);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `browser-api-client-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  showStatus('Backup exported.');
});

importDataBtn.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  importFileInput.value = '';
  if (!file) return;
  const parsed = parseBackup(await file.text());
  if (!parsed.ok) {
    showStatus(parsed.error, true);
    return;
  }
  const current = (await browser.storage.local.get([...BACKUP_KEYS])) as BackupData;
  await browser.storage.local.set(mergeBackup(current, parsed.data) as Record<string, unknown>);
  if (parsed.data.theme) {
    themeSelect.value = parsed.data.theme;
    applyTheme(parsed.data.theme);
  }
  if (parsed.data.maxHistory !== undefined) maxHistoryInput.value = String(parsed.data.maxHistory);
  showStatus(describeImport(parsed.data, parsed.ignoredKeys, parsed.dropped));
});

init().catch((err) => console.error('Options init failed:', err));
