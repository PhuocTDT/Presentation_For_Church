# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source Of Truth

- `docs/README.md`
- `docs/architecture.md`
- `docs/rules.md`
- `docs/debugging-playbook.md`
- `docs/feature-workflow.md`
- `docs/ui-guidelines.md`
- `docs/data-contracts.md`

Caveat: `docs/architecture.md`, `README.md`, and `band-comm-plan.md` still describe the **pre-GĐ2** Kênh Band design (LAN HTTP+WS server, mDNS, `cloudflared` Tunnel spawned by `main.js`) as if it were current. It isn't — trust the "Kênh Band" description in this file instead for that subsystem. The rest of those docs (file responsibilities, data dir layout, debugging/workflow checklists) is still accurate.

## Operating Rules

- Read the repo docs before changing code.
- Check `git status` first so you don't clobber the user's in-progress changes.
- Inspect the exact file(s) you will touch, not just the summary.
- Preserve unrelated user changes.
- Keep changes small and verifiable.
- If behavior changes, update the matching docs.
- Record every change in `changelog.md` (see existing entries for the expected format/detail level) — this is an explicit rule in `docs/rules.md`, not optional cleanup.

## Project Overview

Electron desktop app for church worship presentation (song library, Vietnamese Bible lookup, media backgrounds, drag-and-drop schedule). Two-window architecture: Operator (control) window and Live (projection) window. Main renderer logic is concentrated in `index.html` and `live.html` — each is a monolithic HTML+JS+CSS file, not a component tree. `edit-song.html` was dead code and has been **deleted**; the real song editor is the `#song-editor-modal` embedded inside `index.html` (`openSongEditor()`, `renderLyricsEditor()`, ~line 6150+), including its classic Windows/Tahoma look (`docs/ui-guidelines.md`).

A second subsystem, **Kênh Band**, runs inside the same app: a sidebar in `index.html` (`#bandPanel`) that talks to a **Cloudflare Durable Object relay** (`cloud/worker/src/room-relay.js`, one instance per room) via `src/band-comm/relay-client.js` — both the operator (laptop) and band members (phones, via the web client in `comm/mobile/`) are WebSocket *clients* connecting outward to `channel.worship-official.link`. There is no LAN server and no Cloudflare Tunnel in this path (that was the pre-GĐ2 architecture; it was fully replaced, not layered on top). The old LAN server (`src/band-comm/server.js` and its helpers `ws.js`, `mdns.js`, `accounts.js`, `cognito-jwks.js`, `protocol.js`) and the `cloudflared`-spawning code in `main.js` have been **deleted** (git history has them). Auth for the shared account system goes through a separate Worker (`cloud/identity/`, domain `identity.worship-official.link`) backed by AWS Cognito. `cloud/worker/` and `cloud/identity/` are deployed independently (`wrangler deploy` in each) and are **not** bundled into the Electron build. On the operator side, `src/band-comm/operator-auth.js` (behind `main.js`'s `band-operator-auth-*` IPC handlers) gates the whole subsystem — the relay client doesn't start until the operator is Cognito-authenticated. The local song library is pushed to the cloud by `syncLibraryToCloud()` in `src/band-comm/relay-client.js` (debounced + retried; the payload is built by `getLibraryIndex` in `main.js`) → `POST /library-sync` on `cloud/worker/`, so the web page `comm/setlist/` (served at `/setlist/`) can browse songs, create new ones (sent to an operator review inbox in the Durable Object, approved in the sidebar) and preview slides without the operator's laptop being online. (`src/library-sync.js` is unrelated to the cloud: it only merges song libraries from older installs on the same machine.)

A third subsystem, the **public website** (`website/`), is a separate static site deployed independently to Cloudflare (`cloud/website/wrangler.toml`, domain `worship-official.link`) and **not** bundled into the Electron build either. Three independent pages, each its own HTML+JS+CSS with no shared bundler: `index.html`/`app.js` (marketing landing page, including a client-side-only Kênh Band demo with no real backend calls), `portal.html`/`portal.js` (operator self-service dashboard — Cognito login/session refresh, room & member management, talks to `identity.worship-official.link`), and `admin.html`/`admin.js` (internal admin console over the same identity backend). All three set a strict CSP (`script-src 'self'`, no `unsafe-inline`) — buttons rendered dynamically via `innerHTML` must be wired with delegated `addEventListener` + `data-act`/`data-*` attributes (see the pattern already in `admin.js`), never inline `onclick="..."`, or the handler silently no-ops with only a console CSP warning.

## Build & Run

```bash
npm install
npm start          # electron .
npm run build:win  # electron-builder --win  (nsis + portable)
npm run build:mac  # electron-builder --mac  (dmg)
npm run build       # both platforms
```

No tests or linter are configured. Manual verification is required for every change — run the app and exercise the touched flow.

On Windows, `npm start` fails if `ELECTRON_RUN_AS_NODE` is set in the shell environment (Electron loads as plain Node instead); unset it first if `app` comes back `undefined`.

The `cloudflared` binary is **gone**: the `postinstall` hook, the `extraResources` entry, `scripts/fetch-cloudflared.js`, the `spawn`/tunnel helpers in `main.js` and the `band-comm-tunnel-*` / `band-comm-open-firewall` IPC handlers were all removed (pre-GĐ2 leftovers; `open-firewall` also wrote an elevated PowerShell script into `%TEMP%`).

**Tailwind is a static build, not the Play CDN.** `index.html` loads `src/css/tailwind.generated.css` (committed, built from `tailwind.config.js` by `npm run build:css`, which `build:win/mac/all/store` run automatically) and Google Fonts live in `fonts/google/` + `src/css/google-fonts.css` (regenerate with `node scripts/fetch-google-fonts.js`). **After adding/changing Tailwind classes in `index.html`, run `npm run build:css`** or the new classes won't exist. The renderer must work offline and must not load remote scripts/fonts/images.

**Release builds ship NO content:** `data/` (Bible XML, `songs.json`) and `media/` are not packaged (decision 2026-10-03). The repo's `data/` folder is only used by `npm start` dev runs and as a fixture source; users import their own content following `templates/import/HUONG-DAN-NHAP-DU-LIEU.md` (songs: `.txt/.docx/.json`; Bible: Zefania XML; media: File → Import Media). The import code (`importSongArray`, `validateBibleXmlText` in `main.js`) treats every imported file as untrusted — keep the size limits, schema checks and content-based de-duplication. Code must keep working when `getBundledDataDirs()` is empty. E2E tests that run the real app from a data-less copy: `node --test test/data-import-flow.e2e.mjs` (uses `test/_e2e-app.mjs`; never name a helper `.js` file next to a directory of the same base name — `electron <dir>` will run the file instead and fork-loop).

**Microsoft Store build:** `npm run build:store` (config `electron-builder.store.js`, needs `STORE_IDENTITY_NAME`, `STORE_PUBLISHER`, `STORE_PUBLISHER_DISPLAY_NAME` from Partner Center). Process and review: `docs/microsoft-store-readiness.md`, tracker: `docs/microsoft-store-checklist.md`.

`website/` and `comm/mobile/` have no build step either — edit the HTML/JS/CSS directly and reload; `website/serve-website.js` is a plain-Node static server for local preview of `website/` only (`node website/serve-website.js`, port 3333).

## Typical Change Paths

- Data or schema change: `main.js` + `src/schema.js` + docs
- Renderer / schedule / library change: `index.html` + docs
- Live display change: `live.html` + docs
- Song editor UI change: the `#song-editor-modal` block inside `index.html` (the old standalone `edit-song.html` was deleted) + docs
- IPC contract change: `main.js` (the matching `ipcMain.handle(...)`) + `preload.js` (the matching `contextBridge` method) — the two must be renamed/added together
- Kênh Band relay/protocol change: `cloud/worker/src/room-relay.js` (the Durable Object — this is where the actual server logic lives now) + `src/band-comm/relay-client.js` (operator side) + `comm/mobile/app.js` (phone side) + `docs/data-contracts.md`. Operator-only HTTP endpoints of `cloud/worker/src/worker.js` (`/library-sync`, `/setlist/ack`, `GET /setlist`, `/gallery*`) require `X-Admin-Secret` (verified through the room's Durable Object); `POST /admin/config` only lets the room owner (Cognito token email == `operatorEmail`) re-set the secret — keep both rules (tests: `test/relay-operator-auth.test.mjs`). The old LAN `server.js` no longer exists.
- Kênh Band identity/auth change: `cloud/identity/src/worker.js` (deploy with `npx wrangler deploy` from `cloud/identity/`) + `main.js`'s `band-operator-auth-*` IPC + `src/band-comm/operator-auth.js` (operator laptop) + `comm/mobile/app.js` (phone) + `website/app.js`/`website/portal.js`/`website/admin.js` (all three call `identity.worship-official.link` directly)
- `/setlist/` web page (setlist composer / new song / slide preview): `comm/setlist/*` (+ `slides.js` shared rules must match `normalizeSongLyrics` in `cloud/worker/src/room-relay.js`) + the Worker routes in `cloud/worker/src/worker.js` + `docs/data-contracts.md`. Run the tests in `test/` (`node --test test/*.test.mjs`). The `*.e2e.mjs` ones need a local relay: `node test/start-test-relay.mjs` (wrangler dev with a test-only entry that stubs `bearerIsRoomOwner`, because room bootstrap is Cognito-owner-only) and the browser ones also need `puppeteer-core` (`PUPPETEER_CORE=<path>`), not in package.json.
- Website (marketing/portal/admin) change: matching `website/*.html` + `website/*.js`, plus any shared CSS (e.g. `website/theme-logo.css`) — remember the CSP constraint above (no inline `onclick`)

## Useful Workflows

- Before editing data, check `src/schema.js` for validation and migration behavior.
- Before adding UI behavior, identify whether it affects operator, live, or both.
- Before shipping a change, run the app and inspect the logs for the touched flow.
- Band-comm server/store logic (`src/band-comm/*.js`) has no Electron dependency and can be exercised directly with plain `node` scripts (spin up `createStore`/`createCommServer` against a temp directory) — faster than round-tripping through the full app for server-side changes.

## Constraints To Keep In Mind

- **Renderer hardening (main.js, top of file):** every `ipcMain.handle` is wrapped to reject callers whose frame is not `index.html`/`live.html` loaded from `file://`; navigation/`window.open`/webview are blocked (external links only via `openExternalSafe`: `https:`/`mailto:`); Chromium permissions are deny-by-default (`ALLOWED_PERMISSIONS`). Both HTML files carry a CSP `<meta>` (no remote script/font/image, `connect-src` = self only — the renderer does no direct network I/O; network goes through main). File paths sent by the renderer are **not trusted**: `save-schedule-to-path` and `import-songs-from-file` only accept paths main already saw via a dialog / OS file-open (`approvedSchedulePaths`, `approvedSongImportPaths`). If you add a handler that takes a path, follow that pattern.
- Operator Cognito tokens (`band-comm-operator.json`) are encrypted at rest with Electron `safeStorage`; `src/band-comm/operator-auth.js` stays Electron-free by taking an injected `secretBox`.

- `index.html` is a monolith and contains most renderer logic.
- `live.html` depends on the `app-media://` protocol and the virtual canvas layout.
- Settings and library data are stored in the Electron `userData` directory, not in the project root.
- Bible XML sources may be cached per source file name.
- Kênh Band downstream transport is **WebSocket**, not SSE — Cloudflare Tunnel buffers long-lived streaming HTTP responses, so an SSE stream would silently never deliver operator→phone messages through a tunnel.
- Kênh Band has **no LAN exposure and no Cloudflare Tunnel** as of GĐ2 — `main.js` has no `cloudflared`/tunnel code at all any more. Both operator and phones connect outward over WebSocket to the Durable Object relay at `channel.worship-official.link`; room isolation is per-room via the Room Code, not per-installation via a private tunnel domain. `docs/data-contracts.md`'s "Named Tunnel" section documents the old pre-GĐ2 mechanism for historical/debugging reference only.
- `website/*.html` set a strict CSP (`script-src 'self'`, no `unsafe-inline`/nonce) — inline `onclick="..."` on dynamically-rendered elements fails silently (CSP violation, no visible error). Use delegated `addEventListener` + `data-*` attributes instead.
- `index.html`'s `#song-editor-modal` intentionally keeps a classic Windows/Tahoma look, deliberately distinct from the rest of `index.html`'s modern dark UI (`docs/ui-guidelines.md`) — don't unify styling between them. The old standalone `edit-song.html` no longer exists.
- The old leftover files `src/js/core.js`, `src/js/utils.js`, `src/css/styles.css` were deleted (nothing loaded them); renderer logic lives in `index.html`/`live.html`.
