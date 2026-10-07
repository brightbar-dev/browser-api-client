import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const EXT = '/home/user/browser-api-client/.output/chrome-mv3';
const OUT = process.argv[2];
const ctx = await chromium.launchPersistentContext('/tmp/pw-prof-' + Date.now(), {
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: false, args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  viewport: { width: 1280, height: 800 },
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/app.html`);
await page.waitForSelector('.bac-app');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

await page.getByRole('button', { name: 'New WebSocket request' }).click();
ok(await page.getByRole('status').filter({ hasText: 'Not connected' }).count() === 1, 'new WS tab starts not connected');
await page.getByLabel('WebSocket URL').fill('ws://127.0.0.1:8765/chat');
await page.getByRole('tab', { name: /Connection/ }).click();
ok(await page.getByText('Headers cannot be set.').isVisible(), 'headers limitation is stated in the UI');
await page.getByLabel('Subprotocols').first().fill('chat.v1, other');
await page.getByRole('button', { name: 'Connect', exact: true }).click();
await page.getByRole('status').filter({ hasText: 'Connected' }).first().waitFor();
ok(true, 'connected');
ok(await page.locator('.bac-ws-state').innerText().then(t => /chat\.v1/.test(t)), 'negotiated subprotocol shown');
await page.locator('.bac-ws-entry', { hasText: 'welcome' }).waitFor();
ok(await page.locator('.bac-ws-entry', { hasText: 'welcome' }).count() === 1, 'server greeting logged as received');

await page.getByRole('tab', { name: 'Message', exact: true }).click();
await page.getByLabel('Message to send').fill('{"type":"ping"');
await page.locator('label.bac-seg', { hasText: 'JSON' }).click();
ok(await page.getByText(/Not valid JSON/).isVisible(), 'invalid JSON flagged');
ok(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled() === false, 'send button enabled when open');
await page.getByLabel('Message to send').fill('{"type":"ping"}');
await page.getByRole('button', { name: 'Pretty-print' }).click();
ok((await page.getByLabel('Message to send').inputValue()).includes('\n  "type"'), 'pretty-print reformats JSON');
await page.getByRole('button', { name: 'Save message' }).click();
await page.getByLabel('Message to send').press('Control+Enter');
await page.locator('.bac-ws-entry.is-received', { hasText: 'echo' }).waitFor();
ok(await page.locator('.bac-ws-entry.is-sent').count() === 1, 'sent message logged');
await page.screenshot({ path: `${OUT}/ws-light.png` });

await page.getByLabel('Show').selectOption('sent');
ok(await page.locator('.bac-ws-entry').count() === 1, 'direction filter');
await page.getByLabel('Show').selectOption('all');
await page.getByLabel('Filter messages').fill('echo');
ok(await page.locator('.bac-ws-entry').count() === 1, 'text filter');
await page.getByLabel('Filter messages').fill('');
await page.getByRole('tab', { name: /Saved messages/ }).click();
ok(await page.locator('.bac-ws-saved-item').count() === 1, 'saved message listed');
await page.locator('.bac-ws-saved-item').getByRole('button', { name: /^Send/ }).click();
await page.waitForFunction(() => document.querySelectorAll('.bac-ws-entry.is-sent').length === 2);
ok(true, 'saved message sent');

await page.getByRole('button', { name: /^Save/ }).first().click();
await page.getByRole('dialog').waitFor();
await page.screenshot({ path: `${OUT}/ws-save-dialog.png` });
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Disconnect' }).click();
await page.getByRole('status').filter({ hasText: 'Disconnected' }).waitFor();
ok(await page.locator('.bac-ws-entry', { hasText: 'code 1000' }).count() === 1, 'close code logged');
await page.getByLabel('WebSocket messages').getByRole('button', { name: 'Clear' }).click();
ok(await page.locator('.bac-ws-entry').count() === 0, 'clear empties the log');

// reload: draft + saved messages persist; history has the connection
await page.waitForTimeout(600);
await page.reload(); await page.waitForSelector('.bac-app');
ok(await page.getByLabel('WebSocket URL').inputValue() === 'ws://127.0.0.1:8765/chat', 'WS tab restored after reload');
await page.getByRole('tab', { name: /Saved messages/ }).click();
ok(await page.locator('.bac-ws-saved-item').count() === 1, 'saved messages survive reload');
await page.locator('.bac-sidebar, .bac-side').first().waitFor().catch(() => {});
const hist = await page.evaluate(async () => (await chrome.storage.local.get('history')).history);
ok(hist?.length === 1 && hist[0].request.kind === 'websocket' && hist[0].response.status === 101, 'connection recorded in history');

// dark theme
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await page.getByRole('button', { name: 'Connect', exact: true }).click();
await page.getByRole('status').filter({ hasText: 'Connected' }).first().waitFor();
await page.getByRole('tab', { name: 'Message', exact: true }).click();
await page.locator('label.bac-seg', { hasText: 'Text' }).click();
await page.getByLabel('Message to send').fill('hello dark');
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.locator('.bac-ws-entry.is-received', { hasText: 'hello dark' }).waitFor({ timeout: 4000 }).catch(async () => { await page.screenshot({ path: OUT + '/debug.png' }); console.log(await page.locator('.bac-ws-entries').innerText().catch(() => 'no log')); });
await page.screenshot({ path: `${OUT}/ws-dark.png` });
ok(errors.length === 0, 'no page errors ' + errors.join('|'));
await ctx.close();
