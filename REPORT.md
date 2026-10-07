# WebSocket client — report

(Harvested file: remove before merge, together with `report-evidence/`.)

## What was built
A **WebSocket request type** in the workspace, next to HTTP requests.

- **New request**: `WS` button in the tab strip, or choose "WebSocket" in an HTTP request's method dropdown (its URL maps http→ws, https→wss). A WebSocket tab's type dropdown switches back to HTTP.
- **Connect / Disconnect**, URL with `{{variables}}` (bare hosts default to `ws://` for local hosts, `wss://` otherwise), **subprotocols** (comma/space separated, validated against the RFC 6455 token rule), live **connection state** (not connected / connecting / connected · negotiated subprotocol / disconnecting / disconnected) as a `role=status` text, close code and reason with a plain-language name.
- **Composer**: Text or JSON. JSON is validated live ("Valid JSON" / parser error), **Pretty-print** button, invalid JSON is refused with a message and not sent. Variables are interpolated at send time.
- **Message log**: timestamp (ms), direction (↑ Sent / ↓ Received / Events, never colour alone), size, binary messages shown as a hex dump, pretty-printed JSON toggle, text filter, direction filter (all / messages only / sent / received / events), counts, follow-new toggle, per-entry Copy and Reuse (loads it into the composer), copy-all, download as .txt, **Clear**. Capped at 2000 entries (older ones dropped, and the UI says so); one message is cut for display at 256 KB.
- **Saved messages per request**: Save message → the *Saved messages* tab (rename, Send, Edit in composer, Delete; 200 max). They live in the request, so they follow it into collections.
- **Collections / history**: a WebSocket request is saved with Ctrl/Cmd+S into any collection or folder like an HTTP one, can be dragged/moved/duplicated, shows a `WS` tag in tabs, sidebar collections and history, and is searchable/filterable (`WS` in the history method filter). Each connection writes one **history entry** (status 101 "Connected · N sent, M received", or status 0 "Could not connect"); reopening it restores URL, subprotocols, draft and saved messages. The message log itself is memory-only and never stored.
- **Headers limitation stated in the UI** (Connection tab, always visible when you open it): browsers cannot add headers such as `Authorization` to a WebSocket handshake, so only URL + subprotocols are sent; HTTP Headers/Auth do not apply; suggested alternatives are credential in the URL query, a subprotocol, or a first message. HTTP-only editors (headers, auth, body, tests, Code) are not shown for WS tabs, so nothing pretends to work.
- **Keyboard**: Ctrl/Cmd+Enter connects (idle) or sends the composer message (open); Esc cancels a connecting socket; Alt+L focuses the URL; Enter in the URL field connects; the shortcut sheet lists it. Page unload warns while a socket is live.
- **Accessibility / themes**: labelled controls, tab/tabpanel pattern, `role=log` (aria-live off, to avoid flooding screen readers) with a polite status line for state changes, text+arrow direction cues, visible focus. Light/dark verified in screenshots (new `--m-ws` colour per theme).
- No new permission (manifest still `storage` + `<all_urls>`, verified in `.output/chrome-mv3/manifest.json`) and no new dependency. Strings are in `public/_locales/en/messages.json` (English only).

## Storage format (backward compatible) and migration
`ApiRequest` gained two **optional** members: `kind?: 'websocket'` and `ws?: { protocols, draft, draftFormat, saved[] }`. Requests saved by earlier versions have neither and load as the same HTTP request (byte-identical through re-save). `sanitizeRequest` keeps `ws` only when `kind === 'websocket'` and repairs a damaged `ws` instead of dropping the request. No stored-data rewrite is needed (and none is done). `method` stays `GET` for WS requests, so an older build that opens one sees a harmless GET.
Tests ("storage format" describe in `tests/websocket.test.ts`): legacy workspace/collection/history entries load unchanged and with no new keys; legacy round-trip stable; WS request round-trips through collections, history, workspace and backup export/import; damaged `ws` repaired; unknown `kind` ignored.

## Comparison with the named competitors
- *Postman WebSocket requests*: has connect/disconnect, message composer (text/JSON), saved messages, a log with filter, and (unlike us) headers and its own cloud/account sync. Here: same core features, plus Pretty-print/validation with "refuse invalid JSON", per-entry reuse/copy, download log, hex view for binary, history entry per connection, free and offline, no account. We do **not** offer headers because the browser cannot (Postman's desktop app can) — stated in the UI.
- *Hoppscotch realtime*: connect/disconnect, protocols, message log with timestamps. Here additionally: saved messages per request in collections, environment variables in URL/protocols/messages, filter/clear/export, keyboard shortcuts.
- *Talend API Tester*: I could not verify its WebSocket feature set from this sandbox (no network research done); no claim is made.
Not matched: Socket.IO / STOMP / MQTT-style protocol helpers, auto-reconnect, ping/pong controls (browsers do not expose ping frames), sending binary messages, a message "templates with dynamic values" feature, and headers (browser limitation).

## Validation (exact commands)
- `pnpm exec tsc --noEmit` — pass (no output)
- `pnpm test` — **38 files, 1223 tests passed** (was 36 files / 1183 before; +40 new tests across `tests/websocket.test.ts` and `tests/websocket-client.test.ts`, which drives the connection manager against a fake `WebSocket`; the existing `tests/i18n.test.ts` passes with the new strings)
- `pnpm run build` and `pnpm run build:firefox` — both finish OK
- Playwright e2e against the built extension in Chromium (`/opt/pw-browsers/chromium-1194`) and a local RFC 6455 echo server: 32 checks passed — new WS tab, headers notice, subprotocol negotiation, greeting logged, invalid JSON flagged, pretty-print, send via Ctrl+Enter, direction + text filter, saved message send, close code logged, clear, reload restores tab/URL/saved messages, history entry (status 101, kind websocket), no page errors. Scripts: `report-evidence/e2e-echo-server.mjs`, `report-evidence/e2e-run.mjs` (`node e2e-echo-server.mjs &` then `node e2e-run.mjs <outdir>`). Screenshots: `report-evidence/ws-light.png`, `report-evidence/ws-dark.png`.

## Choices and what is left undone
- **No e2e added to the repo's test suite**: the repo has no e2e/Playwright test harness (only the store-screenshot capture tooling), so the e2e script lives in `report-evidence/` as evidence only.
- Store screenshots (`store/screenshots`) were not regenerated: they show the HTTP workspace, which did not change visually apart from a `WS` button in the tab strip and a WebSocket option in the method dropdown. `store/cws.json` and the README-style docs in CLAUDE.md were not edited (CLAUDE.md is a protected instruction file, so the architecture notes there do not mention `utils/websocket.ts` yet — worth a follow-up line).
- Postman v2.1 export **skips** WebSocket requests (the format has no such item); the native backup includes them.
- The collection runner skips WebSocket requests.
- Binary messages can be received (hex dump) but not sent; no auto-reconnect.
- No version/CHANGELOG/workflow edits were made.
