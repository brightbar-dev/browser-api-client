import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@brightbar-dev/wxt-extpay'],
  extpay: {
    extensionId: 'browser-api-client',
    priceDisplay: '$50/yr',
    priceLabel: 'per year',
    trialDays: 7,
  },
  manifest: {
    name: 'Browser API Client',
    description: 'Lightweight API client in your browser. Build requests, inspect responses, manage environments.',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
  },
});
