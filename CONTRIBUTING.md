# Contributing to RPGDev

Thanks for your interest in contributing to RPGDev — a desktop tool that
turns Codex CLI and Claude Code **hook events** into a small RPG-style overlay
window. It runs on macOS (Swift + WKWebView) and Windows / WSL2 (C# WinForms +
WebView2); bare Linux has no window (`npm run web`). This guide covers local
setup, the dev workflow, and the conventions that keep the codebase consistent.

## Project facts to keep in mind

- **Cross-platform desktop window.** macOS uses a Swift WKWebView window
  (`desktop/RPGDevWindow.swift`) compiled on demand with `swiftc`; Windows/WSL2
  use a C# WinForms+WebView2 window (`desktop/RPGDevWindow.cs`) compiled on
  demand with `csc.exe`, plus a task-tray resident (`desktop/RPGDevTray.cs`).
  Bare Linux has no window. `package.json` declares `"os": ["darwin", "win32",
  "linux"]`. The reducer, server, and frontends are platform-independent; only
  `desktop.mjs` and the native window sources are platform-specific.
- **Node.js 20+**, pure ESM (`"type": "module"`). No build step, no bundler,
  no TypeScript.
- **Zero runtime npm dependencies.** The server and reducer use the Node
  standard library only. There is nothing to `npm install` to run or test.

## Setup

```bash
git clone https://github.com/kitepon-rgb/rpgdev.git
cd rpgdev
```

That's it. There are zero runtime dependencies, so there is no `npm install`
step required to run the server, the reducer, or the tests.

Requirements:

- macOS, or Windows / WSL2 (bare Linux runs the bare server / web view only)
- Node.js 20+
- For the desktop window only (not for tests or the bare server): on macOS the
  Swift compiler / Xcode Command Line Tools; on Windows/WSL2 the in-box
  `csc.exe` (.NET Framework 4.x) — the WebView2 SDK DLLs are bundled under
  `desktop/webview2/`.

## Running the tests

The reducer is exercised by `node:test` (no test framework dependency):

```bash
npm test                                          # run all tests (node --test)
node --test test/adventure-state.test.mjs         # run a single test file
node --test --test-name-pattern "spawns a monster"  # run tests matching a name
```

`server/adventure-state.mjs` is the **single unit-tested module** and the heart
of the app — a pure function
`reduceHookEvent(prevState, hookEvent, now) → { state, effects, normalized }`
with no I/O (`now` is the server-injected pacing clock that `handleHook` passes).
Its tests live in `test/adventure-state.test.mjs` (~66 tests today; `npm test`
runs ~100 across all files).

**If you change behavior in `server/adventure-state.mjs`, you MUST update
`test/adventure-state.test.mjs` to match.** This is the one rule that is not
optional — the reducer is the only thing protected by tests, so its tests are
the contract.

## Architecture (one-way pipeline)

Hook event → reducer → persisted state → SSE broadcast → UI.

1. **Hook CLI** — `scripts/rpg-hook.mjs` (published as `rpgdev-hook <provider>
   <event>`). Reads the hook payload from stdin and POSTs it to the server.
2. **Server** — `server/rpgdev-server.mjs`. A dependency-free `node:http`
   server that runs the reducer, persists state, and broadcasts over SSE.
3. **Reducer / state machine** — `server/adventure-state.mjs`. Pure, no I/O.
   This is where game logic lives.
4. **Desktop window** — `scripts/desktop.mjs`, which dispatches per platform.
   macOS compiles `desktop/RPGDevWindow.swift` on demand and opens a titled,
   4:3 floating WKWebView window (the WebView itself draws no background).
   Windows/WSL2 compile `desktop/RPGDevWindow.cs` (WinForms+WebView2) on demand
   and also build and launch a task-tray resident (`desktop/RPGDevTray.cs`)
   alongside the window.
5. **Frontends** — `public/overlay.js` (the compact window UI) and
   `public/app.js` (a secondary full web view). Both subscribe to `/events`
   (SSE) and only react to the `effects` array; they compute no game logic.
   The server is the single source of truth.

Per-project runtime state and logs are written under `<PROJECT_DIR>/.rpgdev/`
(`state.json`, `events.ndjson`, `playback.ndjson`, `*-errors.log`). `.rpgdev/`
is gitignored. (On Windows/WSL2 the single shared hub keeps its state/build
under `%LOCALAPPDATA%\rpgdev\hub` instead; only error logs stay per-project.)

### Windows / WSL2 specifics

- **Task-tray resident** (`desktop/RPGDevTray.cs`): a C# WinForms NotifyIcon (no
  WebView2) that `scripts/desktop.mjs` builds and launches alongside the window.
  Its icon is the water-spirit Aqua face, cropped at runtime from
  `public/assets/sprites/ally-water-facing-slit.png` via `System.Drawing` (no
  external image tools; `--make-ico` writes the `.ico`). It polls `GET /health`
  every 3s and removes itself after 3 consecutive failures, so tray icon present
  = hub running, gone = hub stopped. Right-click menu: open window / return to
  town (`POST /control/return-town`) / quit, which stops the hub
  (`POST /control/shutdown`). Single instance via a `rpgdev-hub.tray.lock` file
  lock in the hub dir. (Windows hides new tray icons in the overflow `^` by
  default.)
- **Start Menu shortcut**: `rpgdev setup-shortcut` (`scripts/setup-shortcut.mjs`)
  creates `%APPDATA%\Microsoft\Windows\Start Menu\Programs\RPGDev.lnk` with the
  Aqua-face `.ico`; no admin needed, works from WSL2 via interop. Skipped on
  macOS / bare Linux.

## Running the app locally

```bash
npm start              # build the desktop window (per platform) + launch the overlay
npm run server         # HTTP server only (no window)
npm run web            # server + open the full web view in a browser
npm run build:desktop  # compile the desktop window only (does not launch)
npm run demo           # replay a synthetic hook sequence against a running server
npm run trace          # analyze the effect trace from .rpgdev/ logs
```

`npm run demo` requires a server to already be running
(`npm run server`, or the installed `rpgdev` / `rpgdev-server`). It streams a
fake hook sequence — encounter spawn, attacks, defeat, wrap-up — so you can
watch the overlay react without driving a real agent.

This is a desktop / overlay app, not a browser app. Prefer `npm start`,
`npm run server`, the reducer tests, and `npm run demo` for verifying changes.
The full web view at `/` is a secondary, auxiliary view — don't treat it as the
primary surface.

## Audio assets are generated — don't hand-edit WAVs

- BGM (the 7 tracks: `field`, `adventure`, `battle`, `dungeon-adventure`,
  `dungeon-battle`, `castle-adventure`, `castle-battle`) is synthesized by
  `scripts/render-bgm.mjs`. Edit the generator, then run `npm run render:bgm`.
- Attack / return SFX are synthesized by `scripts/render-sfx.mjs`. Edit the
  generator, then run `npm run render:sfx`. New SFX must also be registered in
  the Swift `sfxNames` list in `desktop/RPGDevWindow.swift`.
- **Never hand-edit the WAV files directly.** The generators are deterministic
  (no randomness), so regenerated output is reproducible.
- Exception: `public/audio/monster-appear.wav` and `monster-defeat.wav` are
  standalone assets outside the generators and are *not* regenerated by
  `npm run render:bgm` / `render:sfx`.

## Conventions

- **Zero npm dependencies.** Server and reducer must stay stdlib-only. Don't
  add runtime dependencies.
- **No silent fallbacks.** Don't swallow errors or fake success. The Hook CLI
  logs failures to `.rpgdev/hook-errors.log` + stderr and exits non-zero; the
  server logs to `.rpgdev/server-errors.log`. Preserve this behavior when
  editing — surface errors, don't hide them.
- **No double launch.** The server catches `EADDRINUSE` on listen and exits `0`
  as a late starter (no crash, no error-log noise); the desktop side serializes
  startup via `.rpgdev/desktop.lock` and focuses an existing window instead of
  opening a second one. Don't break these invariants.
- **Keep platform code isolated.** The reducer, server, and frontends must stay
  platform-independent; per-OS branches live only in `scripts/desktop.mjs` and
  the native window sources (`desktop/RPGDevWindow.{swift,cs}`, `RPGDevTray.cs`).

## Commit and pull request flow

1. Create a branch off `main`; don't commit directly to `main`.
2. Make your change. If it touches `server/adventure-state.mjs`, update
   `test/adventure-state.test.mjs` in the same change.
3. Make sure the tests pass:

   ```bash
   npm test
   ```

4. Write a focused commit message describing *what* changed and *why*. Keep the
   change scoped to its purpose — avoid unrelated cleanups in the same PR.
5. Open a pull request against `main` that describes the change, the reasoning,
   and how you verified it (tests, `npm run demo`, or the desktop window).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
