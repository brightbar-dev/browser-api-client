/**
 * Capture CWS store screenshots for Browser API Client.
 *
 * Usage:
 *   1. Build first: npm run build
 *   2. Run: npx playwright test store-assets/capture-screenshots.ts --headed
 *
 * The popup UI is the main interface, so all screenshots can be captured
 * by opening popup.html directly and interacting with it.
 */

import { test, chromium } from '@playwright/test';
import path from 'node:path';

const EXTENSION_PATH = path.resolve(__dirname, '../.output/chrome-mv3');
const SCREENSHOT_DIR = __dirname;

async function getExtensionId(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>): Promise<string> {
  for (const sw of context.serviceWorkers()) {
    const url = sw.url();
    if (url.includes('chrome-extension://')) {
      return url.split('//')[1].split('/')[0];
    }
  }
  const sw = await context.waitForEvent('serviceworker');
  return sw.url().split('//')[1].split('/')[0];
}

test('Open browser for popup screenshots', async () => {
  test.setTimeout(300_000); // 5 min

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
    ],
  });

  const extensionId = await getExtensionId(context);

  // Open the popup as a tab
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.setViewportSize({ width: 420, height: 600 });
  await popupPage.waitForTimeout(500);

  console.log('\n=== Browser API Client Screenshot Instructions ===');
  console.log(`Popup URL: chrome-extension://${extensionId}/popup.html`);
  console.log('');
  console.log('For each screenshot, interact with the popup then use');
  console.log('Cmd+Shift+5 (Mac) to capture. Save to store-assets/.');
  console.log('');
  console.log('Needed screenshots (resize to 1280x800 or 640x400):');
  console.log('  screenshot-01-request-response.png — GET to jsonplaceholder, show response');
  console.log('  screenshot-02-post-with-body.png — POST with JSON body + Bearer auth');
  console.log('  screenshot-03-environments.png — Show environment vars (Pro feature)');
  console.log('  screenshot-04-export-curl.png — Show cURL export of a request');
  console.log('  screenshot-05-collections.png — Show organized request groups');
  console.log('');
  console.log('Press Ctrl+C when done.');
  console.log('===================================================\n');

  await new Promise(() => {});
});
