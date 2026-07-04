# ADR 0001: Random encounters with reducer-authoritative state

- Status: Accepted
- Date: 2026-07-04
- Source: README.md, CLAUDE.md, server/adventure-state.mjs, docs/01_design-todo-rpg.md

## Context

RPGDev converts Codex / Claude Code hook events into a desktop RPG overlay. Earlier model notes in [01_design-todo-rpg.md](../01_design-todo-rpg.md) describe why error-text matching and TODO-as-monster models were rejected: text matching produced false positives, and TODO-only combat made sessions without TODO updates visually quiet.

## Decision

Use random encounters as the monster model, driven by hook events, while keeping the reducer as the only authority for game state.

- `PreToolUse` may spawn at most one encounter according to reducer rules and pacing.
- TODO updates maintain the quest log and can defeat linked encounters, but TODO items do not directly spawn monsters.
- `server/adventure-state.mjs` owns game-state transitions as a pure function; server code injects time and persists/broadcasts the result.
- The UI renders reducer state/effects and does not compute game logic.

## Consequences

- Combat can happen even without TODO usage.
- Multi-agent sessions remain paced by server-authoritative state rather than UI timing or hook flood volume.
- Reducer behavior must stay covered by `npm test`; changes to encounter semantics require updates to [01_design-todo-rpg.md](../01_design-todo-rpg.md) and reducer tests.
