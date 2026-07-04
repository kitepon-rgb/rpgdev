# RPGDev documentation overview

RPGDev turns Codex / Claude Code hook events into a small desktop RPG overlay. This page is the entry map for repository documentation.

## Canonical docs

- [01_design-todo-rpg.md](01_design-todo-rpg.md) - Game model, reducer behavior, hook semantics, pacing, ownership, and implementation status. Read this before changing game logic.
- [02_windows-wsl.md](02_windows-wsl.md) - Windows / WSL2 desktop host, single-hub architecture, platform requirements, and verification checklist.
- [adr/0001-random-encounter-reducer-authority.md](adr/0001-random-encounter-reducer-authority.md) - Root architecture decision: random encounters with reducer-authoritative state.

## Operational docs

These files are intentionally not numbered because they are recipes or release notes rather than design canon.

- [agent-install.md](agent-install.md) - Instructions for an AI coding agent installing RPGDev for a user.
- [install-hooks.md](install-hooks.md) - Hook setup and safe merge rules.
- [releasing.md](releasing.md) - npm release procedure and historical publish notes.

## Repository map

- `server/` - HTTP server and pure reducer-backed state machine.
- `scripts/` - CLI entry points, desktop launcher, hook setup, trace tools, and asset generators.
- `public/` - Overlay/web UI, CSS, audio, fonts, and sprites.
- `desktop/` - Native desktop hosts for macOS and Windows/WSL2.
- `test/` - `node:test` coverage for reducer and platform helpers.
- `examples/` - Manual hook configuration examples.
- `rag/` - Research reuse shelf; currently empty except for its index.
