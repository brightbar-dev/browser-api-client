# Browser API Client — Browser Extension

## What This Is
Lightweight API client right in your browser. Build requests, inspect responses, manage environments, export as cURL/fetch/Python. Positioned as a lightweight alternative to Postman — no desktop app, no account required.

Built with [WXT](https://wxt.dev/) — builds for Chrome (MV3) and Firefox (MV2) from one codebase.

## Architecture
- **entrypoints/background.ts** — Service worker. The toolbar button opens `app.html` in a tab, or focuses the one already open (Chrome: `runtime.getContexts`; Firefox: the app page answers a `focusApp` message). Serializes history writes and owns the history, environment and collection storage messages.
- **entrypoints/app/** — The workspace, a full-tab Preact app. `library.ts` holds collection/environment actions (save to collection, move across collections, environment CRUD); `components/Dialogs.tsx` has the save, environment editor, import and code-snippet dialogs; `components/VarField.tsx` colours `{{variables}}` (defined vs undefined) in any input or textarea. `store.ts` holds state and persists the open tabs' drafts to `storage.local` (debounced, flushed on pagehide); `send.ts` executes requests from the page itself (extension pages bypass CORS for `<all_urls>`), with `AbortController` cancel and `credentials: 'omit'`; `components/` has the sidebar (History grouped by day with method/status filters; Collections tree with one level of folders, drag and Alt+Arrow reorder, rename, duplicate, Postman export; Environments with active switch, duplicate, export), request tab strip, request editor (URL ⇄ params sync, headers, auth, body modes) and response viewer (pretty/tree/raw JSON, sandboxed HTML preview, image preview, hex view, search, download).
- **entrypoints/options/** — Settings page (theme, history limit, backup export/import through `utils/backup.ts`).
- **utils/request.ts** — Request model (body modes: none, JSON, x-www-form-urlencoded, multipart, raw text, binary file, GraphQL), resolved-request types, formatting.
- **utils/url.ts** — Raw-text URL ⇄ query params sync, scheme defaulting (`http://` for local hosts, `https://` otherwise).
- **utils/resolve.ts** — Turns an editable request into exactly what is sent: variables, auth, Content-Type, forbidden-header and body warnings.
- **utils/response.ts** — Body classification (json/html/xml/text/image/binary), decoding, hex dump, search, history summaries, fetch error explanations.
- **utils/workspace.ts** — Open request tabs: add/close/move, unsaved-change detection, restore from storage.
- **utils/sanitize.ts** / **utils/backup.ts** — Validate stored and imported data; backups only ever carry known keys.
- **utils/idb.ts** — IndexedDB for file bodies and each tab's last response (bytes that don't belong in `storage.local`).
- **utils/environment.ts** — Environment variable interpolation (`{{var}}` names may use letters, digits, `_ . -`), segmentation for highlighting, duplicate/rename, secret flag.
- **utils/codegen.ts** — Code snippets from a resolved request: cURL, JavaScript fetch, Node axios, Python requests, Go net/http, PHP cURL, C# HttpClient, HTTPie; every string literal escaped for its language.
- **utils/curl-import.ts** — Parse a `curl` command (bash, DevTools cmd style) into a request.
- **utils/openapi-import.ts** — OpenAPI 3 / Swagger 2 JSON to a collection (folders by tag, example bodies from schemas) plus an environment of variables.
- **utils/har-import.ts** — HAR 1.2 entries to requests.
- **utils/import-detect.ts** — Detect what pasted text is and run the matching importer.
- **utils/history.ts** — Request history sorting, grouping by day, filtering (query, method, status bucket), truncation.
- **utils/collections.ts** — Collections with one level of folders: upsert/move/duplicate/remove requests anywhere, folder operations, tree search.
- **utils/import-export.ts** — Postman v2.1 collection (nested folders, every body mode) and environment import/export, native export.

## Key Implementation Details
- The UI is a full browser tab, never a popup, so nothing is lost when focus leaves it. Every edit to an open request is saved as a draft and restored on reload; a page with an in-flight request asks before unloading.
- Requests run in the app page with `fetch()`: host permission `<all_urls>` bypasses CORS; the browser's cookies are never attached (`credentials: 'omit'`).
- Environment variables use `{{variable}}` mustache syntax, interpolated at send time
- Auth support: Bearer Token, Basic Auth, API Key (header or query)
- Files chosen for multipart/binary bodies are stored in IndexedDB so drafts with files survive a reload
- History is written by the background (serialized) up to the user's max-entries setting; response bodies over 64 KB are cut in history
- Import: Postman v2.1 collections and environments, cURL (dialog or paste into the URL bar), OpenAPI 3 / Swagger 2 JSON, HAR. Export: collections to Postman v2.1, environments to Postman, code snippets in 8 languages, native backup from Settings
- Save with Cmd/Ctrl+S: in place for a request opened from a collection, otherwise a dialog asks where
- No account, no pairing, no cloud — ever. Everything stays in the browser.
- UI framework: Preact (MIT, ~10 KB), because the workspace is large enough that declarative rendering removes a class of stale-DOM bugs. Keep logic in `utils/` (Node-tested); components stay thin.
- All DOM classes are prefixed with `bac-`

## Monetization
- Free for everyone: full request builder, unlimited history, multiple environments, collections. No payment code ships in the package.
- Ruling (Ken, 2026-09-15): keep the whole extension free for now; a Pro tier may come later. Sunk cost — no hosting/server bills to recoup. If a paid tier is added, see brightbar-dev/org-work `RUNBOOK.md` § "Adding a paid tier later" for the checklist (ExtensionPay registration, re-adding `wxt-extpay`, CWS Payments toggle, etc.).

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
npx tsc --noEmit   # CI runs this too
```
- Vitest unit tests for every `utils/` module (Node environment, no DOM); `background.test.ts` uses `wxt/testing/fake-browser` for the message handlers
- UI behaviour is verified by hand in Chrome for Testing; each PR description lists what was checked

## Conventions
- WXT framework, TypeScript; Preact for the app page (the options page stays vanilla)
- Version: semver, 0.2.x (CWS-submitted), 1.x = production-ready
- Conventional commits: feat:, fix:, chore:
- Do NOT add Claude/AI as co-author or contributor
