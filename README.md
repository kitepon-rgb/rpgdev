# RPGDev

> Turn your Codex CLI / Claude Code hook events into a tiny RPG playing out on your desktop (macOS, Windows, WSL2).

English | [日本語](README.ja.md)

[![npm](https://img.shields.io/npm/v/rpgdev)](https://www.npmjs.com/package/rpgdev)
![license](https://img.shields.io/npm/l/rpgdev)
![node](https://img.shields.io/node/v/rpgdev)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20WSL2-lightgrey)

RPGDev is a small desktop overlay (macOS, Windows, and WSL2) that converts the **hook events** your AI coding agent emits — Codex CLI and Claude Code — into a classic JRPG-style scene. Every tool call becomes a battle action, your TODO list becomes a quest log, and elemental spirits join you as allies while you work. It's a passive, ambient "your terminal is an adventure" companion: you don't play it, you just code and watch the adventure unfold.

## Demo

<!-- Maintainer: drop a screenshot or GIF of the desktop overlay here, e.g. docs/screenshot.png, and reference it below. -->
<!-- ![RPGDev overlay](docs/screenshot.png) -->

_A small window sits on your desktop and reacts in real time as you work._

## Features

- **Random encounters** — Monsters aren't tied to TODO items. They appear as a random encounter on every tool use (`PreToolUse`, ~20% chance), at most one at a time. Sprite and HP are picked from a stage-specific catalog (field: Slime / Goblin / Orc / Ogre, dungeon and castle have their own rosters).
- **TODO-driven quests** — Your TODO list (Claude `TodoWrite` / Codex `update_plan`) is shown as an on-screen quest log. Completing a TODO can be the trigger that defeats a linked encounter.
- **Elemental spirit allies** — Up to four spirits join the fight (Ignis / Terra / Sylph / Aqua = fire / earth / wind / water), follow up after the hero's skill attacks, and retire after taking enough hits. `SubagentStart` / `SubagentStop` bring allies in and out.
- **Counter-attacks on failure** — When a tool fails, the enemy strikes back (Claude detects this via `PostToolUseFailure` / `PermissionDenied`; Codex hooks don't report tool success/failure, so no counter there).
- **Adventure stages with BGM** — As your TODOs progress, the scene advances field → dungeon → castle, swapping background art and one of seven original JRPG-style BGM tracks.
- **Works with both Codex and Claude Code** — One set of hooks, one server, two providers.

## How defeat works

The win condition is fixed the moment a monster appears, based on whether a TODO was in progress:

- **No `in_progress` TODO at spawn** → defeat with **5 hero skill attacks** (`PostToolUse`) or by ending the turn (`Stop`).
- **An `in_progress` TODO at spawn** → the encounter is *linked*; attacks can't kill it. It falls when one TODO becomes `completed`, or on turn end (`Stop`).

HP is purely for show.

## Requirements

- Node.js 20+ (all platforms)
- **macOS** — Swift compiler / Xcode Command Line Tools (the window is compiled on-demand with `swiftc`)
- **Windows** — WebView2 Runtime (preinstalled on Windows 11) + .NET Framework 4.x `csc.exe` (the window is a C# WinForms + WebView2 host, compiled on-demand). The WebView2 SDK DLLs are bundled, so no extra download. See [docs/windows-wsl.md](docs/windows-wsl.md).
- **WSL2** — `.wslconfig` with `localhostForwarding=true`; the window is built and shown on the Windows host. See [docs/windows-wsl.md](docs/windows-wsl.md).
- **bare Linux** — no desktop window yet; use the browser view (`npm run web`).

## Install

```bash
npm install -g rpgdev
```

## Quick start

```bash
rpgdev
```

A small RPGDev window opens on your desktop (macOS / Windows; on WSL2 it appears on the Windows host). Runtime state and logs are written per-project under `.rpgdev/`. Windows/WSL2 setup details: [docs/windows-wsl.md](docs/windows-wsl.md).

To open just the web view instead of the native window:

```bash
rpgdev-server --open    # http://127.0.0.1:37373/
```

## Hooks setup

RPGDev is fed by hook events, so your coding agent needs a few hook entries pointing at `rpgdev-hook`.

**Easiest — let your AI agent do it.** You already have one open; just ask:

> Set up RPGDev hooks for me (follow `node_modules/rpgdev/docs/install-hooks.md`).

It runs `rpgdev setup` to get the exact config for your machine and merges it into your settings
**without touching anything else**. RPGDev never edits your files itself — your agent does, in front of
you. Recipe: [docs/install-hooks.md](docs/install-hooks.md).

**By hand.** Run `rpgdev setup` (add `--codex` or `--all` for Codex, `--user` for the home-level
config) and copy the printed JSON into `.claude/settings.local.json` (or `.codex/hooks.json`):

```bash
rpgdev setup            # prints the Claude Code config + where to put it
rpgdev setup --all      # both Claude Code and Codex
```

The printed config runs the hook via an absolute path to node + the installed hook script, so it works
on macOS, Windows, and WSL2 alike (no `PATH` / `.cmd`-shim surprises).

> **Reference configs:** [`examples/`](examples/) holds static snapshots for manual copying (they
> assume a global install). Prefer `rpgdev setup`, which writes the more robust absolute-path form.

Your agent may ask you to trust / review project-local hooks before they run.

### Hook → action map

| Hook | What happens |
| --- | --- |
| `UserPromptSubmit` | Start the adventure, open the window, head to the field |
| `PreToolUse` | 20% chance to spawn an encounter; in battle, 20% chance an ally joins; otherwise advance (no attack) |
| `PostToolUse` | `TodoWrite` / `update_plan` update the quest log; any other tool is a hero **skill attack** (move name = the tool name, formatted) — allies follow up here too |
| `PostToolUseFailure` / `PermissionDenied` *(Claude only)* | The enemy counter-attacks |
| `SubagentStart` / `SubagentStop` | An ally spirit joins / returns (FIFO — first in, first out) |
| `Stop` | End of turn: any present encounter is defeated and you return to town |

If the hook CLI can't reach the server it does **not** silently succeed — it logs to stderr and `.rpgdev/hook-errors.log` and exits non-zero.

## How it works

RPGDev is a strict **one-way pipeline**:

```
Hook event → reducer → persisted state → SSE broadcast → UI
```

1. **Hook CLI** (`rpgdev-hook <provider> <event>`) reads the hook payload from stdin, ensures the server is up, and POSTs it to `/hook`.
2. **Server** (`node:http`, zero npm dependencies) runs the reducer, persists the result, and broadcasts over SSE.
3. **Reducer** (`server/adventure-state.mjs`) is a pure function, `reduceHookEvent(prevState, hookEvent) → { state, effects }`, with no I/O. **It is the single source of truth** — the only unit-tested module, and the heart of the app. The UI never computes game logic; it just reacts to the broadcast `effects`.
4. **UI** — a desktop window hosting the overlay (`public/overlay.js`): a Swift `WKWebView` on macOS, a C# WinForms + WebView2 host on Windows / WSL2 (`scripts/desktop.mjs` dispatches per platform). Plus a secondary full web view at `/` (`public/app.js`). Both subscribe to `/events` via `EventSource`.

The reducer is also responsible for **pacing**: spawn cooldowns and minimum on-screen lifetimes keep the scene calm even when many agents flood it with events, so monsters never flicker in and out.

## Development

```bash
npm test                 # run the node:test suite (the reducer's tests)
npm start                # build + launch the desktop window (per platform)
npm run server           # HTTP server only (no window)
npm run web              # server + open the full web view
npm run build:desktop    # compile the desktop window only (Swift on macOS, C# on Windows/WSL2)
npm run demo             # replay a synthetic hook sequence against a running server
npm run trace            # analyze effect traces from .rpgdev/ logs
npm run render:bgm       # regenerate the 7 BGM tracks
npm run render:sfx       # regenerate attack / return SFX
```

There is **no build/bundle step and no TypeScript** — the whole project is plain ESM with **zero runtime npm dependencies** (stdlib only). BGM and SFX are deterministically generated WAVs; edit the generators, then re-run `render:bgm` / `render:sfx` rather than editing the audio directly.

The full design rationale and real-world hook verification notes live in [docs/design-todo-rpg.md](docs/design-todo-rpg.md) — read it before touching the reducer.

## License

[MIT](LICENSE)
