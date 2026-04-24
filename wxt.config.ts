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
    name: '__MSG_appName__',
    description: '__MSG_appDescription__',
    default_locale: 'en',
    permissions: ['storage'],
    host_permissions: ['<all_urls>'],
  },
});
