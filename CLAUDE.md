# Browser API Client — Browser Extension

## What This Is
Lightweight API client right in your browser. Build requests, inspect responses, manage environments, export as cURL/fetch/Python. Positioned as a lightweight alternative to Postman — no desktop app, no account required.

Built with [WXT](https://wxt.dev/) — builds for Chrome (MV3) and Firefox (MV2) from one codebase.

## Architecture
- **entrypoints/background.ts** — Service worker. Executes HTTP requests (bypasses CORS), manages storage for history/environments/collections.
- **entrypoints/popup/** — Main UI: URL bar with method selector, tabbed request config (Params, Headers, Auth, Body), response viewer with status/time/size, response body/headers tabs.
- **entrypoints/options/** — Settings page (theme, history limit, data export/import).
- **utils/request.ts** — HTTP request/response types, URL building/parsing, header building with auth, formatting.
- **utils/environment.ts** — Environment variable interpolation (`{{var}}` syntax), variable extraction, merging.
- **utils/export.ts** — Export requests as cURL, JavaScript fetch(), or Python requests.
- **utils/history.ts** — Request history sorting, filtering (method, URL, status), truncation.
- **utils/collections.ts** — Named request groups: create, add/remove/update/move/search/duplicate.
- **utils/import-export.ts** — Postman v2.1 import/export, native backup/restore, format detection.

## Key Implementation Details
- Requests execute via background service worker (bypasses page CORS restrictions)
- Environment variables use `{{variable}}` mustache syntax, interpolated at send time
- Auth support: Bearer Token, Basic Auth, API Key header
- Response body auto-formats JSON with pretty-print
- Export to cURL, fetch(), or Python requests
- History auto-saves with configurable max entries
- Collections: named groups of saved requests with search and duplicate
- Import/export: Postman v2.1 collections and environments, native backup format
- Auto-detects import format (Postman collection, Postman environment, or native)
- All DOM elements prefixed with `bac-` to avoid host page conflicts

## Monetization
- Free tier: full request builder, 50 history entries, 1 environment
- Pro tier: unlimited history, multiple environments, collections, request chaining
- Pricing: $49/yr or $5/mo via ExtensionPay
- Payment: `@brightbar-dev/wxt-extpay` module (auto-injects content script, provides helpers)
- ExtPay ID: `browser-api-client` (not yet registered on extensionpay.com — see HT-025)
- **Architecture:** Popup calls ExtPay directly via `createExtPay()`. Background only runs `initBackground()`. Do NOT proxy ExtPay through background messaging.

## Commands
```bash
npm run dev          # Dev mode with HMR (Chrome)
npm run dev:firefox  # Dev mode (Firefox)
npm run build        # Production build (Chrome)
npm run build:firefox # Production build (Firefox)
npm run zip          # Build + zip for store submission
npm run test         # Run Vitest tests
npm run test:watch   # Watch mode
```

## Testing
```bash
npm test
```
- 138 unit tests via Vitest + WXT testing plugin
- 8 test files: request (31), environment (12), export (9), history (9), collections (19), import-export (16), payment (22), tier-gate (20)
- All pure utility logic, no browser API mocking needed

## Conventions
- WXT framework with vanilla TypeScript (no UI framework)
- Version: semver, 0.1.x (MVP), 1.x = production-ready
- Conventional commits: feat:, fix:, chore:
- Do NOT add Claude/AI as co-author or contributor
