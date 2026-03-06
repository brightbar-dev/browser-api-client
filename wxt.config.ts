import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Browser API Client',
    description: 'Lightweight API client in your browser. Build requests, inspect responses, manage environments.',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
  },
});
