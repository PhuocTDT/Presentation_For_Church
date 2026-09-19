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

A second subsystem, **Kênh Band**, runs inside the same app: a sidebar in `index.html` (`#bandPanel`) that talks to a **Cloudflare Durable Object relay** (`cloud/worker/src/room-relay.js`, one instance per room) via `src/band-comm/relay-client.js` — both the operator (laptop) and band members (phones, via the web client in `comm/mobile/`) are WebSocket *clients* connecting outward to `channel.worship-official.link`. There is no LAN server and no Cloudflare Tunnel in this path (that was the pre-GĐ2 architecture; it was fully replaced, not layered on top). `src/band-comm/server.js` (the old LAN HTTP+WS server) and the `cloudflared`-spawning code in `main.js` (`syncBandTunnel()`) still exist in the repo but are dead code — nothing calls them anymore. Auth for the shared account system goes through a separate Worker (`cloud/identity/`, domain `identity.worship-official.link`) backed by AWS Cognito. `cloud/worker/` and `cloud/identity/` are deployed independently (`wrangler deploy` in each) and are **not** bundled into the Electron build.

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
- Kênh Band relay/protocol change: `cloud/worker/src/room-relay.js` (the Durable Object — this is where the actual server logic lives now) + `src/band-comm/relay-client.js` (operator side) + `comm/mobile/app.js` (phone side) + `docs/data-contracts.md`. `src/band-comm/server.js` is dead code (pre-GĐ2 LAN server) — do not edit it expecting it to affect runtime behavior.
- Kênh Band identity/auth change: `cloud/identity/src/worker.js` (deploy with `npx wrangler deploy` from `cloud/identity/`) + `main.js`'s operator-auth IPC + `comm/mobile/app.js` for the phone-side Cognito login

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
