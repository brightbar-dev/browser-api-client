import { buildUrl, buildHeaders, formatSize, formatTime, statusColor, newRequest, isJsonContentType, prettyJson } from '@/utils/request';
import { interpolate } from '@/utils/environment';
import { toCurl } from '@/utils/export';
import type { ApiRequest, KeyValuePair, AuthConfig } from '@/utils/request';
import type { EnvVariable, Environment } from '@/utils/environment';

// DOM elements
const methodSelect = document.getElementById('method-select') as HTMLSelectElement;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const envSelector = document.getElementById('env-selector') as HTMLSelectElement;
const paramsList = document.getElementById('params-list')!;
const headersList = document.getElementById('headers-list')!;
const addParamBtn = document.getElementById('add-param')!;
const addHeaderBtn = document.getElementById('add-header')!;
const authType = document.getElementById('auth-type') as HTMLSelectElement;
const authFields = document.getElementById('auth-fields')!;
const bodyType = document.getElementById('body-type') as HTMLSelectElement;
const bodyInput = document.getElementById('body-input') as HTMLTextAreaElement;
const responseSection = document.getElementById('response-section')!;
const responseStatus = document.getElementById('response-status')!;
const responseTime = document.getElementById('response-time')!;
const responseSize = document.getElementById('response-size')!;
const responseBody = document.getElementById('response-body')!;
const responseHeaders = document.getElementById('response-headers')!;
const copyResponseBtn = document.getElementById('copy-response')!;
const exportCurlBtn = document.getElementById('export-curl')!;
const optionsLink = document.getElementById('options-link')!;

let currentRequest: ApiRequest = newRequest();
let environments: Environment[] = [];
let activeEnvVars: EnvVariable[] = [];

async function init() {
  const settings = await browser.runtime.sendMessage({ action: 'getSettings' });
  applyTheme(settings.theme || 'auto');
  await loadEnvironments();
  setupTabs();
  setupListeners();
  renderKvList(paramsList, currentRequest.params, 'param');
  renderKvList(headersList, currentRequest.headers, 'header');
}

function applyTheme(theme: string) {
  if (theme === 'auto') {
    document.body.classList.toggle('bac-dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  } else {
    document.body.classList.toggle('bac-dark', theme === 'dark');
  }
}

async function loadEnvironments() {
  environments = await browser.runtime.sendMessage({ action: 'getEnvironments' }) || [];
  const { activeEnvId } = await browser.storage.local.get('activeEnvId');

  envSelector.innerHTML = '<option value="">No Environment</option>';
  for (const env of environments) {
    const opt = document.createElement('option');
    opt.value = env.id;
    opt.textContent = env.name;
    if (env.id === activeEnvId) opt.selected = true;
    envSelector.appendChild(opt);
  }

  updateActiveEnv(activeEnvId);
}

function updateActiveEnv(envId: string | null) {
  const env = environments.find(e => e.id === envId);
  activeEnvVars = env ? env.variables.filter(v => v.enabled) : [];
  browser.storage.local.set({ activeEnvId: envId || null });
}

function setupTabs() {
  // Request tabs
  document.querySelectorAll('.bac-tabs .bac-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bac-tabs .bac-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.bac-tab-content').forEach(c => (c as HTMLElement).style.display = 'none');
      const target = (tab as HTMLElement).dataset.tab;
      document.getElementById(`tab-${target}`)!.style.display = '';
    });
  });

  // Response tabs
  document.querySelectorAll('.bac-response-tabs .bac-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bac-response-tabs .bac-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = (tab as HTMLElement).dataset.rtab;
      responseBody.style.display = target === 'body' ? '' : 'none';
      responseHeaders.style.display = target === 'headers' ? '' : 'none';
    });
  });
}

function setupListeners() {
  sendBtn.addEventListener('click', sendRequest);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendRequest(); });
  addParamBtn.addEventListener('click', () => {
    currentRequest.params.push({ key: '', value: '', enabled: true });
    renderKvList(paramsList, currentRequest.params, 'param');
  });
  addHeaderBtn.addEventListener('click', () => {
    currentRequest.headers.push({ key: '', value: '', enabled: true });
    renderKvList(headersList, currentRequest.headers, 'header');
  });
  envSelector.addEventListener('change', () => updateActiveEnv(envSelector.value || null));
  authType.addEventListener('change', () => renderAuthFields());
  copyResponseBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(responseBody.textContent || '');
  });
  exportCurlBtn.addEventListener('click', () => {
    syncRequestFromUI();
    navigator.clipboard.writeText(toCurl(currentRequest));
  });
  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });
}

function renderKvList(container: HTMLElement, items: KeyValuePair[], prefix: string) {
  container.innerHTML = items.map((item, i) => `
    <div class="bac-kv-row">
      <input type="checkbox" ${item.enabled ? 'checked' : ''} data-idx="${i}" data-field="enabled" class="bac-kv-check" />
      <input type="text" value="${escapeAttr(item.key)}" placeholder="Key" data-idx="${i}" data-field="key" class="bac-kv-key" />
      <input type="text" value="${escapeAttr(item.value)}" placeholder="Value" data-idx="${i}" data-field="value" class="bac-kv-val" />
      <button class="bac-kv-del" data-idx="${i}" title="Remove">&times;</button>
    </div>
  `).join('');

  container.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt((input as HTMLElement).dataset.idx!);
      const field = (input as HTMLElement).dataset.field!;
      if (field === 'enabled') {
        items[idx].enabled = (input as HTMLInputElement).checked;
      } else {
        (items[idx] as any)[field] = (input as HTMLInputElement).value;
      }
    });
  });

  container.querySelectorAll('.bac-kv-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.idx!);
      items.splice(idx, 1);
      renderKvList(container, items, prefix);
    });
  });
}

function renderAuthFields() {
  const type = authType.value;
  currentRequest.auth.type = type as AuthConfig['type'];

  if (type === 'bearer') {
    authFields.innerHTML = `<input type="text" id="auth-token" placeholder="Token" class="bac-auth-input" value="${escapeAttr(currentRequest.auth.token || '')}" />`;
    authFields.querySelector('#auth-token')!.addEventListener('input', (e) => {
      currentRequest.auth.token = (e.target as HTMLInputElement).value;
    });
  } else if (type === 'basic') {
    authFields.innerHTML = `
      <input type="text" id="auth-user" placeholder="Username" class="bac-auth-input" value="${escapeAttr(currentRequest.auth.username || '')}" />
      <input type="password" id="auth-pass" placeholder="Password" class="bac-auth-input" value="${escapeAttr(currentRequest.auth.password || '')}" />`;
    authFields.querySelector('#auth-user')!.addEventListener('input', (e) => {
      currentRequest.auth.username = (e.target as HTMLInputElement).value;
    });
    authFields.querySelector('#auth-pass')!.addEventListener('input', (e) => {
      currentRequest.auth.password = (e.target as HTMLInputElement).value;
    });
  } else if (type === 'api-key') {
    authFields.innerHTML = `
      <input type="text" id="auth-key-name" placeholder="Header Name" class="bac-auth-input" value="${escapeAttr(currentRequest.auth.headerName || '')}" />
      <input type="text" id="auth-key-value" placeholder="Header Value" class="bac-auth-input" value="${escapeAttr(currentRequest.auth.headerValue || '')}" />`;
    authFields.querySelector('#auth-key-name')!.addEventListener('input', (e) => {
      currentRequest.auth.headerName = (e.target as HTMLInputElement).value;
    });
    authFields.querySelector('#auth-key-value')!.addEventListener('input', (e) => {
      currentRequest.auth.headerValue = (e.target as HTMLInputElement).value;
    });
  } else {
    authFields.innerHTML = '';
  }
}

function syncRequestFromUI() {
  currentRequest.method = methodSelect.value as any;
  currentRequest.url = urlInput.value;
  currentRequest.bodyType = bodyType.value as any;
  currentRequest.body = bodyInput.value;
}

async function sendRequest() {
  syncRequestFromUI();

  if (!currentRequest.url) {
    urlInput.focus();
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = '...';

  // Interpolate environment variables
  const url = buildUrl(
    interpolate(currentRequest.url, activeEnvVars),
    currentRequest.params.map(p => ({
      ...p,
      key: interpolate(p.key, activeEnvVars),
      value: interpolate(p.value, activeEnvVars),
    }))
  );

  const headers = buildHeaders(
    currentRequest.headers.map(h => ({
      ...h,
      key: interpolate(h.key, activeEnvVars),
      value: interpolate(h.value, activeEnvVars),
    })),
    currentRequest.auth
  );

  if (currentRequest.bodyType === 'json' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const body = currentRequest.body ? interpolate(currentRequest.body, activeEnvVars) : undefined;

  try {
    const response = await browser.runtime.sendMessage({
      action: 'executeRequest',
      url,
      method: currentRequest.method,
      headers,
      body: (currentRequest.method !== 'GET' && currentRequest.method !== 'HEAD') ? body : undefined,
    });

    displayResponse(response);

    // Save to history
    await browser.runtime.sendMessage({
      action: 'addHistory',
      entry: {
        id: Date.now().toString(36),
        request: { ...currentRequest },
        response,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    displayResponse({
      status: 0,
      statusText: (error as Error).message,
      headers: {},
      body: '',
      size: 0,
      time: 0,
      contentType: '',
    });
  }

  sendBtn.disabled = false;
  sendBtn.textContent = 'Send';
}

function displayResponse(res: any) {
  responseSection.style.display = '';

  const color = statusColor(res.status);
  responseStatus.textContent = res.status ? `${res.status} ${res.statusText}` : `Error: ${res.statusText}`;
  responseStatus.className = `bac-status bac-${color}`;
  responseTime.textContent = formatTime(res.time);
  responseSize.textContent = formatSize(res.size);

  // Body
  if (isJsonContentType(res.contentType)) {
    responseBody.textContent = prettyJson(res.body);
  } else {
    responseBody.textContent = res.body;
  }

  // Headers
  const headerEntries = Object.entries(res.headers as Record<string, string>);
  responseHeaders.innerHTML = headerEntries.map(([k, v]) =>
    `<div class="bac-header-row"><span class="bac-header-key">${escapeHtml(k)}</span><span class="bac-header-val">${escapeHtml(v)}</span></div>`
  ).join('');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

init();
