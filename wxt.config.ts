import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'preact',
    },
  }),
  manifest: {
    name: '__MSG_appName__',
    description: '__MSG_appDescription__',
    default_locale: 'en',
    // `identity` (OAuth authorization-code sign-in) and `webRequest` (redirect chain, Set-Cookie,
    // named network errors) are held back: each new permission needs a store justification and
    // lengthens review. The code already degrades without them (oauth.ts, network.ts).
    permissions: ['storage'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '__MSG_appName__',
    },
  },
});
