# RPGDev

> Turn your Codex CLI / Claude Code hook events into a tiny RPG playing out on your macOS desktop.

English | [日本語](README.ja.md)

[![npm](https://img.shields.io/npm/v/rpgdev)](https://www.npmjs.com/package/rpgdev)
![license](https://img.shields.io/npm/l/rpgdev)
![node](https://img.shields.io/node/v/rpgdev)
![platform](https://img.shields.io/badge/platform-macOS-lightgrey)

RPGDev is a small macOS desktop overlay that converts the **hook events** your AI coding agent emits — Codex CLI and Claude Code — into a classic JRPG-style scene. Every tool call becomes a battle action, your TODO list becomes a quest log, and elemental spirits join you as allies while you work. It's a passive, ambient "your terminal is an adventure" companion: you don't play it, you just code and watch the adventure unfold.

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

- macOS (the overlay is a native Swift window)
- Node.js 20+
- Swift compiler / Xcode Command Line Tools (the desktop window is compiled on-demand with `swiftc`)

## Install

```bash
npm install -g rpgdev
```

## Quick start

```bash
rpgdev
```

A small RPGDev window opens on your macOS desktop. Runtime state and logs are written per-project under `.rpgdev/`.

To open just the web view instead of the native window:

```bash
rpgdev-server --open    # http://127.0.0.1:37373/
```

## Hooks setup

RPGDev is fed by hook events. Wire up the example configs:

- **Claude Code** — copy [`examples/claude-settings.local.json`](examples/claude-settings.local.json) → `.claude/settings.local.json`
- **Codex** — copy [`examples/codex-hooks.json`](examples/codex-hooks.json) → `.codex/hooks.json`

> **Note on call style:** the two providers invoke the hook differently. Claude passes the provider and event name as an `args` array (`"command": "rpgdev-hook", "args": ["claude", "PostToolUse"]`), while Codex writes them inline in the `command` string (`"command": "rpgdev-hook codex PostToolUse"`). The example configs already use the correct form for each.

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
4. **UI** — a Swift `WKWebView` desktop window (`public/overlay.js`), plus a secondary full web view at `/` (`public/app.js`). Both subscribe to `/events` via `EventSource`.

The reducer is also responsible for **pacing**: spawn cooldowns and minimum on-screen lifetimes keep the scene calm even when many agents flood it with events, so monsters never flicker in and out.

## Development

```bash
npm test                 # run the node:test suite (the reducer's tests)
npm start                # build + launch the macOS desktop window
npm run server           # HTTP server only (no window)
npm run web              # server + open the full web view
npm run build:desktop    # compile the Swift window only
npm run demo             # replay a synthetic hook sequence against a running server
npm run trace            # analyze effect traces from .rpgdev/ logs
npm run render:bgm       # regenerate the 7 BGM tracks
npm run render:sfx       # regenerate attack / return SFX
```

There is **no build/bundle step and no TypeScript** — the whole project is plain ESM with **zero runtime npm dependencies** (stdlib only). BGM and SFX are deterministically generated WAVs; edit the generators, then re-run `render:bgm` / `render:sfx` rather than editing the audio directly.

The full design rationale and real-world hook verification notes live in [docs/design-todo-rpg.md](docs/design-todo-rpg.md) — read it before touching the reducer.

## License

[MIT](LICENSE)
