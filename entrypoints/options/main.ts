const themeSelect = document.getElementById('theme') as HTMLSelectElement;
const maxHistoryInput = document.getElementById('max-history') as HTMLInputElement;
const clearHistoryBtn = document.getElementById('clear-history')!;
const exportDataBtn = document.getElementById('export-data')!;
const importDataBtn = document.getElementById('import-data')!;
const importFileInput = document.getElementById('import-file') as HTMLInputElement;

async function init() {
  const settings = await browser.storage.local.get(['theme', 'maxHistory']);
  themeSelect.value = settings.theme || 'auto';
  maxHistoryInput.value = String(settings.maxHistory || 100);
}

themeSelect.addEventListener('change', () => {
  browser.storage.local.set({ theme: themeSelect.value });
});

maxHistoryInput.addEventListener('change', () => {
  const val = Math.max(10, Math.min(1000, parseInt(maxHistoryInput.value) || 100));
  browser.storage.local.set({ maxHistory: val });
});

clearHistoryBtn.addEventListener('click', async () => {
  if (confirm('Clear all request history?')) {
    await browser.runtime.sendMessage({ action: 'clearHistory' });
    alert('History cleared.');
  }
});

exportDataBtn.addEventListener('click', async () => {
  const data = await browser.storage.local.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `browser-api-client-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importDataBtn.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await browser.storage.local.set(data);
    alert('Data imported successfully. Reload the extension to see changes.');
  } catch {
    alert('Invalid JSON file.');
  }
});

init().catch(err => console.error('Options init failed:', err));
