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

## Operating Rules

- Read the repo docs before changing code.
- Inspect the exact file(s) you will touch, not just the summary.
- Preserve unrelated user changes.
- Keep changes small and verifiable.
- If behavior changes, update the matching docs.

## Project Overview

Electron desktop app for church worship presentation (song library, Vietnamese Bible lookup, media backgrounds, drag-and-drop schedule). Two-window architecture: Operator (control) window and Live (projection) window. Main renderer logic is concentrated in `index.html`, `live.html`, `edit-song.html` — each is a monolithic HTML+JS+CSS file, not a component tree.

A second subsystem, **Kênh Band**, runs inside the same app: a LAN HTTP+WebSocket server (`src/band-comm/`) that a sidebar in `index.html` (`#bandPanel`) talks to, serving a phone-facing web client (`comm/mobile/`) for real-time alerts, a chord-sheet image gallery, and setlist composing. `main.js` bundles a `cloudflared` binary (fetched by `scripts/fetch-cloudflared.js` at install time, packaged via `build.win.extraResources`) and **always auto-spawns a tunnel** once band-comm starts — Quick Tunnel (random `*.trycloudflare.com` URL) by default, or a stable Named Tunnel if `band-comm.json`'s `tunnelName` is set (via the in-app wizard, or `cloud/tunnel/start-tunnel.bat` as a manual/legacy alternative). A Cloudflare Worker (`cloud/worker/`) backs a message queue for setlists sent while the laptop is off. `cloud/worker/` is deployed independently (`wrangler deploy`) and is **not** bundled into the Electron build.

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

## Typical Change Paths

- Data or schema change: `main.js` + `src/schema.js` + docs
- Renderer / schedule / library change: `index.html` + docs
- Live display change: `live.html` + docs
- Song editor UI change: `edit-song.html` + docs
- IPC contract change: `main.js` (the matching `ipcMain.handle(...)`) + `preload.js` (the matching `contextBridge` method) — the two must be renamed/added together
- Kênh Band server/protocol change: `src/band-comm/server.js` (+ `store.js` for persisted config, `protocol.js` for the envelope shape) + `comm/mobile/app.js` for the phone side + `docs/data-contracts.md`
- Kênh Band cloud queue change: `cloud/worker/src/worker.js` (deploy with `npx wrangler deploy` from `cloud/worker/`) + the matching fetch calls in `src/band-comm/server.js` (`pollCloud`) and `comm/mobile/app.js` (`sendSetlistToCloud`)

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
- `main.js` **always** spawns `cloudflared` itself (`syncBandTunnel()`) once band-comm starts — there is no "off" state. Default (`band-comm.json`'s `tunnelName` empty) is **Quick Tunnel**: `cloudflared tunnel --url http://127.0.0.1:<port>`, exposing the LAN comm server on a random `*.trycloudflare.com` URL that changes every start. Setting `tunnelName` switches to **Named Tunnel** (`cloudflared tunnel run <tunnelName>`) with a stable operator-owned domain instead. This means the LAN server is reachable from the public internet by default on every launch, not just when explicitly configured — see `docs/data-contracts.md`'s "Named Tunnel" section for the full mode table.
