<!--
RPGDev: macOS-only RPG overlay for Codex / Claude Code hook events.
Read docs/design-todo-rpg.md (single source of truth) before changing the reducer.
-->

## Summary

<!-- One or two sentences: what this PR does and why. -->

## What changed

<!-- Bullet the concrete changes. Call out anything touching the reducer
     (server/adventure-state.mjs), the server, the Swift window, or the
     overlay/web frontends. Note any new BGM/SFX assets or generator edits. -->

-

## How tested

<!-- `npm test` (node --test) must pass. If you changed the reducer
     (server/adventure-state.mjs), update test/adventure-state.test.mjs —
     it is the only unit-tested module. Mention any manual verification
     in the desktop window (`npm start`) or via `npm run demo` / `npm run trace`. -->

- [ ] `npm test` passes

## Checklist

- [ ] `npm test` passes
- [ ] Reducer changes are covered by updated `test/adventure-state.test.mjs`
- [ ] Docs updated (`README.md` / `CLAUDE.md` / `docs/`) if behavior changed
- [ ] No new npm runtime dependencies (server + reducer stay stdlib-only)
- [ ] macOS-only assumptions respected (Swift window, `swiftc`, generated WAV assets)
- [ ] BGM/SFX changes go through the generators (`npm run render:bgm` / `npm run render:sfx`), WAVs not edited by hand
