// Store listing screenshots (1280×800) and promo tiles from the real built extension in Chrome for Testing.
// Demo API: https://api.example.com is mapped to the local HTTPS fixture (server.mjs) with --host-resolver-rules.
// Usage (see CLAUDE.md "Store listing assets"):
//   PLAYWRIGHT=/path/to/playwright/index.mjs CHROME=/path/to/chrome node store/capture/capture.mjs .output/chrome-mv3 store
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

if (!process.env.PLAYWRIGHT || !process.env.CHROME) {
  console.error('Set PLAYWRIGHT (path to playwright/index.mjs) and CHROME (Chrome for Testing binary).');
  process.exit(2);
}
const { chromium } = await import(process.env.PLAYWRIGHT);
const exe = process.env.CHROME;
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ext = path.resolve(process.argv[2] || path.join(repo, '.output/chrome-mv3'));
const out = path.resolve(process.argv[3] || path.join(repo, 'store'));
fs.mkdirSync(`${out}/screenshots`, { recursive: true });
fs.mkdirSync(`${out}/promo`, { recursive: true });

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'bac-store-profile-')), {
  headless: true, executablePath: exe, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP api.example.com:443 127.0.0.1:8443', '--ignore-certificate-errors'],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`chrome-extension://${id}/app.html`);
await page.waitForSelector('.bac-app');

const accept = { key: 'Accept', value: 'application/json', enabled: true };
const bearer = { type: 'bearer', token: '{{apiToken}}' };
const rule = (id, source, path, op, expected) => ({ id, enabled: true, source, path, op, expected });
const req = (id, name, method, url, extra = {}) => {
  const q = url.split('?')[1];
  const params = q ? q.split('&').map((s) => { const [key, value = ''] = s.split('='); return { key, value, enabled: true }; }) : [];
  return { id, name, method, url, headers: [accept], params, body: '', bodyType: 'none', auth: bearer, ...extra };
};

const seed = {
  welcomed: true,
  theme: 'light',
  layout: { sidebarOpen: true, sidebarWidth: 276, sidebarPanel: 'collections', requestFraction: 0.36 },
  environments: [
    { id: 'env-prod', name: 'Production', variables: [
      { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
      { key: 'apiToken', value: 'sk_live_51Hc9demo4f9a7c2e81b3', enabled: true, secret: true },
      { key: 'customerId', value: 'cus_7Hq2', enabled: true },
      { key: 'orderId', value: 'ord_1042', enabled: true },
      { key: 'clientSecret', value: 'cs_demo_7c1e0b9a', enabled: true, secret: true },
    ] },
    { id: 'env-staging', name: 'Staging', variables: [
      { key: 'baseUrl', value: 'https://staging-api.example.com', enabled: true },
      { key: 'apiToken', value: 'sk_test_demo', enabled: true, secret: true },
    ] },
  ],
  activeEnvId: 'env-prod',
  collections: [
    {
      id: 'col-store', name: 'Storefront API', description: '', created: 1, updated: 2,
      requests: [
        req('r-me', 'Get current user', 'GET', '{{baseUrl}}/v1/me', {
          auth: { type: 'oauth2', oauth2: { grant: 'client_credentials', authUrl: '', tokenUrl: '{{baseUrl}}/oauth/token', clientId: 'storefront-dashboard', clientSecret: '{{clientSecret}}', scope: 'orders:read orders:write', audience: '', usePkce: true, clientAuth: 'header' } },
          assertions: [rule('a-me', 'status', '', 'equals', '200')],
        }),
        req('r-health', 'Health check', 'GET', '{{baseUrl}}/v1/health', { assertions: [rule('a-h', 'status', '', 'equals', '200'), rule('a-h2', 'jsonpath', '$.checks.search', 'equals', '"ok"')] }),
      ],
      folders: [
        { id: 'f-orders', name: 'Orders', requests: [
          req('r-list', 'List shipped orders', 'GET', '{{baseUrl}}/v1/orders?status=shipped&limit=20', {
            assertions: [rule('a1', 'status', '', 'equals', '200'), rule('a2', 'jsonpath', '$.data[0].status', 'equals', '"shipped"'), rule('a3', 'time', '', 'lt', '800')],
            extractions: [{ id: 'x1', enabled: true, source: 'jsonpath', path: '$.data[0].id', variable: 'orderId' }],
          }),
          req('r-get', 'Get order', 'GET', '{{baseUrl}}/v1/orders/{{orderId}}', { assertions: [rule('a4', 'status', '', 'equals', '200'), rule('a5', 'jsonpath', '$.tracking.carrier', 'exists', '')] }),
          req('r-create', 'Create order', 'POST', '{{baseUrl}}/v1/orders', {
            headers: [accept, { key: 'Idempotency-Key', value: '9f1c2e7a-order-demo', enabled: true }],
            bodyType: 'json', body: '{\n  "customer": "{{customerId}}",\n  "items": [\n    { "sku": "MUG-STN-GRY", "qty": 2 }\n  ]\n}',
            assertions: [rule('a6', 'status', '', 'equals', '201'), rule('a7', 'header', 'Location', 'exists', '')],
          }),
          req('r-cancel', 'Cancel order', 'DELETE', '{{baseUrl}}/v1/orders/{{orderId}}', { assertions: [rule('a8', 'status', '', 'equals', '204')] }),
        ] },
        { id: 'f-customers', name: 'Customers', requests: [
          req('r-cust', 'Get customer', 'GET', '{{baseUrl}}/v1/customers/{{customerId}}', { assertions: [rule('a9', 'jsonpath', '$.tier', 'exists', '')] }),
        ] },
        { id: 'f-inventory', name: 'Inventory', requests: [
          req('r-stock', 'Low stock', 'GET', '{{baseUrl}}/v1/inventory/low-stock', { assertions: [rule('a10', 'jsonpath', '$.data', 'type-is', 'array')] }),
        ] },
      ],
    },
    { id: 'col-hooks', name: 'Payments webhooks', description: '', created: 1, updated: 1, requests: [req('r-hook', 'Replay payment.succeeded', 'POST', '{{baseUrl}}/v1/webhooks/replay')], folders: [] },
  ],
};
// Seed from the options page with the app page closed, so the app never writes its first-run draft over the seed.
await page.close();
const seeder = await ctx.newPage();
await seeder.goto(`chrome-extension://${id}/options.html`);
await seeder.evaluate(async (seed) => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set(seed);
}, seed);
await seeder.close();
const page2 = await ctx.newPage();
page2.on('dialog', (d) => d.accept());
page2.on('pageerror', (e) => console.log('pageerror', String(e)));
await page2.goto(`chrome-extension://${id}/app.html`);
await page2.waitForSelector('.bac-app');
await page2.waitForTimeout(400);

const tree = (name) => page2.locator('.bac-tree-main', { hasText: name }).first();
const toPng = async (name) => {
  const file = `${out}/screenshots/${name}.png`;
  await page2.screenshot({ path: file, type: 'png' });
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${file}').convert('RGB'); im.save('${file}', optimize=True)`]);
  return file;
};
async function sendAndWait() {
  await page2.locator('.bac-urlbar .bac-send').click();
  await page2.waitForFunction(() => !document.querySelector('.bac-sending') && (document.querySelector('.bac-status') || document.querySelector('.bac-error-card')), null, { timeout: 15000 });
}

// Collapse the webhooks collection so the tree reads cleanly.
await page2.locator('.bac-tree-main', { hasText: 'Payments webhooks' }).click();

// 1. Workspace with a JSON response.
await tree('Create order').click();
await tree('Get customer').click();
await tree('List shipped orders').click();
await sendAndWait();
await page2.locator('#bac-req-tab-params').click();
await page2.mouse.move(640, 790);
await page2.waitForTimeout(300);
await toPng('01-workspace-json-response');

// Prime history with a few real sends.
for (const name of ['Get customer', 'Create order']) {
  await tree(name).click();
  await sendAndWait();
}

// 2. Environments with {{variables}}.
await tree('Get order').click();
await page2.locator('#bac-req-tab-headers').click();
await page2.locator('.bac-header [aria-label="Edit the active environment"]').click();
await page2.locator('dialog.bac-dialog').waitFor();
await page2.waitForTimeout(300);
await toPng('02-environments-variables');
await page2.locator('dialog.bac-dialog').getByRole('button', { name: 'Done' }).click();

// 3. Collection run with pass/fail.
await page2.getByRole('button', { name: 'Actions for Storefront API' }).click();
await page2.getByRole('menuitem', { name: 'Run collection' }).click();
const dlg = page2.locator('dialog.bac-dialog');
await dlg.getByRole('button', { name: /^Run \d+ requests$/ }).click();
await page2.waitForFunction(() => /passed/.test(document.querySelector('.bac-run-summary')?.textContent || ''), null, { timeout: 20000 });
await page2.waitForTimeout(400);
await dlg.locator('.bac-run-name', { hasText: 'Cancel order' }).click();
await page2.waitForTimeout(200);
await toPng('03-collection-runner');
console.log('runner:', await dlg.locator('.bac-run-summary').innerText());
await dlg.getByRole('button', { name: 'Close' }).click();

// 4. OAuth 2.0.
await page2.evaluate(() => chrome.storage.local.remove('oauthTokens'));
await page2.evaluate(() => chrome.storage.local.set({ layout: { sidebarOpen: true, sidebarWidth: 276, sidebarPanel: 'collections', requestFraction: 0.64 } }));
await page2.reload();
await page2.waitForSelector('.bac-app');
await tree('Get current user').click();
await page2.locator('#bac-req-tab-auth').click();
await page2.getByRole('button', { name: 'Get new access token' }).click();
await page2.waitForFunction(() => /Access token ready/.test(document.querySelector('.bac-token-box')?.textContent || ''), null, { timeout: 10000 });
await sendAndWait();
await page2.locator('.bac-request-panel').evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page2.waitForTimeout(4300);
await toPng('04-oauth2-auth');

// 5. Import from cURL.
await page2.evaluate(() => chrome.storage.local.set({ layout: { sidebarOpen: true, sidebarWidth: 276, sidebarPanel: 'collections', requestFraction: 0.36 } }));
await page2.reload();
await page2.waitForSelector('.bac-app');
await tree('List shipped orders').click();
await sendAndWait();
await page2.locator('.bac-header').getByRole('button', { name: 'Import' }).click();
const curl = `curl https://api.example.com/v1/orders \\\n  -X POST \\\n  -H 'Authorization: Bearer sk_live_51Hc9demo4f9a7c2e81b3' \\\n  -H 'Idempotency-Key: 5d2b7f0e-1c9a-4e6b' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{"customer":"cus_3Lm9","items":[{"sku":"LAMP-OAK-01","qty":1}],"shipping":{"method":"express"}}'`;
await page2.locator('dialog.bac-dialog [aria-label="Text to import"]').fill(curl);
await page2.waitForTimeout(300);
await toPng('05-import-curl-openapi-postman');
await page2.keyboard.press('Escape');

// Promo tiles rendered from HTML, using screenshot 1 as the product shot.
const shotB64 = fs.readFileSync(`${out}/screenshots/01-workspace-json-response.png`).toString('base64');
const icon = fs.readFileSync(path.join(repo, 'public/icon-bac.svg'), 'utf8');
const iconUri = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`;
const tile = await ctx.newPage();
const font = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
await tile.setViewportSize({ width: 440, height: 280 });
await tile.setContent(`<!doctype html><html><body style="margin:0;width:440px;height:280px;overflow:hidden;font-family:${font};background:linear-gradient(135deg,#032e22 0%,#036349 55%,#0f8a66 100%);color:#fff;">
  <div style="padding:34px 32px;">
    <div style="display:flex;align-items:center;gap:12px;"><img src="${iconUri}" width="44" height="44"><div style="font-size:24px;font-weight:700;letter-spacing:-0.3px;">Browser API Client</div></div>
    <div style="margin-top:22px;font-size:21px;line-height:1.3;font-weight:600;">A full API client<br>in a browser tab.</div>
    <div style="margin-top:14px;font-size:14px;opacity:.85;">Collections · OAuth 2.0 · Tests · cURL &amp; OpenAPI import</div>
    <div style="margin-top:18px;display:inline-block;padding:5px 12px;border-radius:14px;background:rgba(255,255,255,.14);font-size:13px;font-weight:600;">No account. No cloud. Free.</div>
  </div></body></html>`);
await tile.screenshot({ path: `${out}/promo/small-440x280.png`, type: 'png' });
await tile.setViewportSize({ width: 1400, height: 560 });
await tile.setContent(`<!doctype html><html><body style="margin:0;width:1400px;height:560px;overflow:hidden;font-family:${font};background:linear-gradient(120deg,#032e22 0%,#036349 50%,#0f8a66 100%);color:#fff;position:relative;">
  <div style="position:absolute;left:72px;top:92px;width:470px;">
    <div style="display:flex;align-items:center;gap:14px;"><img src="${iconUri}" width="52" height="52"><div style="font-size:28px;font-weight:700;">Browser API Client</div></div>
    <div style="margin-top:30px;font-size:40px;line-height:1.15;font-weight:700;letter-spacing:-0.6px;">The API client that lives in your browser.</div>
    <ul style="margin:26px 0 0;padding:0;list-style:none;font-size:19px;line-height:1.9;opacity:.92;">
      <li>✓ Collections, environments &amp; OAuth 2.0</li>
      <li>✓ Tests and request chaining — no scripts</li>
      <li>✓ Import cURL, OpenAPI, Postman &amp; HAR</li>
    </ul>
    <div style="margin-top:22px;display:inline-block;padding:7px 16px;border-radius:18px;background:rgba(255,255,255,.14);font-size:16px;font-weight:600;">No account. No cloud. Free.</div>
  </div>
  <div style="position:absolute;left:600px;top:58px;width:900px;height:562px;border-radius:12px 0 0 0;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45);background:#fff;">
    <div style="height:30px;background:#e9ecef;display:flex;align-items:center;gap:7px;padding-left:14px;"><span style="width:11px;height:11px;border-radius:50%;background:#ff5f57"></span><span style="width:11px;height:11px;border-radius:50%;background:#febc2e"></span><span style="width:11px;height:11px;border-radius:50%;background:#28c840"></span></div>
    <img src="data:image/png;base64,${shotB64}" style="display:block;width:1280px;height:800px;transform:scale(0.72);transform-origin:0 0;">
  </div></body></html>`);
await tile.screenshot({ path: `${out}/promo/marquee-1400x560.png`, type: 'png' });
for (const f of ['small-440x280', 'marquee-1400x560']) {
  const file = `${out}/promo/${f}.png`;
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${file}').convert('RGB'); im.save('${file}', optimize=True)`]);
}
execFileSync('python3', ['-c', `
from PIL import Image
import glob
for p in sorted(glob.glob('${out}/*/*.png')):
    im = Image.open(p); print(p.split('/')[-1], im.size, im.mode)`], { stdio: 'inherit' });
await ctx.close();
