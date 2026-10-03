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

Electron desktop app for church worship presentation (song library, Vietnamese Bible lookup, media backgrounds, drag-and-drop schedule). Two-window architecture: Operator (control) window and Live (projection) window. Main renderer logic is concentrated in `index.html` and `live.html` — each is a monolithic HTML+JS+CSS file, not a component tree. `edit-song.html` is **dead code**: `main.js` never `loadFile()`s it (only `live.html` and `index.html`); the real song editor is the `#song-editor-modal` embedded inside `index.html` (`openSongEditor()`, `renderLyricsEditor()`, ~line 6150+), including its classic Windows/Tahoma look (`docs/ui-guidelines.md`) — edits to the standalone `edit-song.html` file have zero effect on the shipped app.

A second subsystem, **Kênh Band**, runs inside the same app: a sidebar in `index.html` (`#bandPanel`) that talks to a **Cloudflare Durable Object relay** (`cloud/worker/src/room-relay.js`, one instance per room) via `src/band-comm/relay-client.js` — both the operator (laptop) and band members (phones, via the web client in `comm/mobile/`) are WebSocket *clients* connecting outward to `channel.worship-official.link`. There is no LAN server and no Cloudflare Tunnel in this path (that was the pre-GĐ2 architecture; it was fully replaced, not layered on top). `src/band-comm/server.js` (the old LAN HTTP+WS server) and the `cloudflared`-spawning code in `main.js` (`syncBandTunnel()`) still exist in the repo but are dead code — nothing calls them anymore. Auth for the shared account system goes through a separate Worker (`cloud/identity/`, domain `identity.worship-official.link`) backed by AWS Cognito. `cloud/worker/` and `cloud/identity/` are deployed independently (`wrangler deploy` in each) and are **not** bundled into the Electron build. On the operator side, `src/band-comm/operator-auth.js` (behind `main.js`'s `band-operator-auth-*` IPC handlers) gates the whole subsystem — the relay client doesn't start until the operator is Cognito-authenticated. `src/library-sync.js` pushes the local song library up to the cloud (`POST /library-sync` on `cloud/worker/`) so phones can browse/pick songs for the setlist composer (`GET /library`) without the operator's laptop being online.

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

`postinstall` runs `scripts/fetch-cloudflared.js`, which downloads the `cloudflared` binary bundled into the Windows build (`vendor/cloudflared/`, wired via `extraResources` in `package.json`). This is leftover from the pre-GĐ2 tunnel architecture — nothing in the current code invokes the binary at runtime, but the build still ships it.

`website/` and `comm/mobile/` have no build step either — edit the HTML/JS/CSS directly and reload; `website/serve-website.js` is a plain-Node static server for local preview of `website/` only (`node website/serve-website.js`, port 3333).

## Typical Change Paths

- Data or schema change: `main.js` + `src/schema.js` + docs
- Renderer / schedule / library change: `index.html` + docs
- Live display change: `live.html` + docs
- Song editor UI change: the `#song-editor-modal` block inside `index.html` (NOT the standalone `edit-song.html` — that file is dead code, never loaded) + docs
- IPC contract change: `main.js` (the matching `ipcMain.handle(...)`) + `preload.js` (the matching `contextBridge` method) — the two must be renamed/added together
- Kênh Band relay/protocol change: `cloud/worker/src/room-relay.js` (the Durable Object — this is where the actual server logic lives now) + `src/band-comm/relay-client.js` (operator side) + `comm/mobile/app.js` (phone side) + `docs/data-contracts.md`. `src/band-comm/server.js` is dead code (pre-GĐ2 LAN server) — do not edit it expecting it to affect runtime behavior.
- Kênh Band identity/auth change: `cloud/identity/src/worker.js` (deploy with `npx wrangler deploy` from `cloud/identity/`) + `main.js`'s `band-operator-auth-*` IPC + `src/band-comm/operator-auth.js` (operator laptop) + `comm/mobile/app.js` (phone) + `website/app.js`/`website/portal.js`/`website/admin.js` (all three call `identity.worship-official.link` directly)
- Website (marketing/portal/admin) change: matching `website/*.html` + `website/*.js`, plus any shared CSS (e.g. `website/theme-logo.css`) — remember the CSP constraint above (no inline `onclick`)

## Useful Workflows

- Before editing data, check `src/schema.js` for validation and migration behavior.
- Before adding UI behavior, identify whether it affects operator, live, or both.
- Before shipping a change, run the app and inspect the logs for the touched flow.
- Band-comm server/store logic (`src/band-comm/*.js`) has no Electron dependency and can be exercised directly with plain `node` scripts (spin up `createStore`/`createCommServer` against a temp directory) — faster than round-tripping through the full app for server-side changes.

## Constraints To Keep In Mind

- `index.html` is a monolith and contains most renderer logic.
- `live.html` depends on the `app-media://` protocol and the virtual canvas layout.
- Settings and library data are stored in the Electron `userData` directory, not in the project root.
- Bible XML sources may be cached per source file name.
- Kênh Band downstream transport is **WebSocket**, not SSE — Cloudflare Tunnel buffers long-lived streaming HTTP responses, so an SSE stream would silently never deliver operator→phone messages through a tunnel.
- Kênh Band has **no LAN exposure and no Cloudflare Tunnel** as of GĐ2 — `main.js` never spawns `cloudflared` for band-comm anymore (`syncBandTunnel()` is unreferenced dead code). Both operator and phones connect outward over WebSocket to the Durable Object relay at `channel.worship-official.link`; room isolation is per-room via the Room Code, not per-installation via a private tunnel domain. `docs/data-contracts.md`'s "Named Tunnel" section documents the old pre-GĐ2 mechanism for historical/debugging reference only.
- `website/*.html` set a strict CSP (`script-src 'self'`, no `unsafe-inline`/nonce) — inline `onclick="..."` on dynamically-rendered elements fails silently (CSP violation, no visible error). Use delegated `addEventListener` + `data-*` attributes instead.
- `index.html`'s `#song-editor-modal` intentionally keeps a classic Windows/Tahoma look, deliberately distinct from the rest of `index.html`'s modern dark UI (`docs/ui-guidelines.md`) — don't unify styling between them. The standalone `edit-song.html` file is unrelated dead code (see Project Overview).
- `src/js/core.js`, `src/js/utils.js`, and `src/css/styles.css` are unreferenced leftover files — nothing in `index.html`/`live.html` loads them; don't assume renderer logic lives there.
