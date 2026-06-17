# RPGDev hook setup — recipe for an AI agent

This document is written for an **AI coding agent** (Claude Code, Codex, …). If a user asks you to
"set up RPGDev hooks", follow these steps exactly. RPGDev itself never edits the user's settings —
**you** apply the change, carefully, in front of the user.

RPGDev turns the user's coding-agent hook events (every tool call, prompt, subagent, turn end) into a
small desktop RPG. To make that happen, the user's agent must call `rpgdev-hook` on each hook event.
Your job is to add those hook entries to the right settings file without breaking anything.

## Prerequisite

`rpgdev` must be installed on disk (the hook runs a file from the package on every tool call):

```
npm install -g rpgdev      # or: clone the repo and run from source
```

## Step 1 — ask the user two things

1. **Which agent** to wire up: Claude Code, Codex, or both.
2. **Scope**: this project only (default) or the whole machine (home-level config).

## Step 2 — get the correct config (do not hand-write it)

Run the setup command for the chosen provider and scope, and read its output. It prints the exact
config with the **real absolute paths for this machine** and the correct command form per platform —
so you never have to guess paths, event names, or the Windows command form.

```
rpgdev setup --claude            # Claude Code, this project
rpgdev setup --codex             # Codex, this project
rpgdev setup --all               # both
rpgdev setup --claude --user     # Claude Code, home-level (~)
rpgdev setup --json --claude     # raw JSON only
```

The output tells you the **target file path** and the **JSON to merge**.

- Claude Code → `<scope>/.claude/settings.local.json`
- Codex → `<scope>/.codex/hooks.json`

(`<scope>` is the project directory by default, or the user's home directory with `--user`.)

## Step 3 — merge it safely (these rules are mandatory)

Read the target file (it may already contain the user's own settings). Then:

- **Touch only `.hooks`.** Never modify or drop any other key — `permissions`, `env`, `model`,
  `mcpServers`, `statusLine`, or anything else stays exactly as it was.
- **Keep the user's existing hooks.** For each event, append the rpgdev entry to the existing array;
  do not replace the user's own hooks for that event.
- **Idempotent.** Each rpgdev entry carries `"_rpgdev": "rpgdev"`. If an entry with that marker
  already exists for an event, **update its path in place** instead of adding a duplicate. Re-running
  setup after an npm update (which may move the install path) should refresh the path, not duplicate it.
- **Never overwrite invalid JSON.** If the existing file is not valid JSON, **stop and tell the user** —
  do not replace it.
- **Back up first.** Before writing, copy the existing file to a backup (e.g.
  `settings.local.json.rpgdev-bak`). Do not overwrite an existing backup.
- **Write atomically if you can** (write a temp file, then rename over the target) so a crash can't
  truncate the user's settings.
- **Show the user the diff** before/after writing.

## Step 4 — confirm it works

- **Claude Code** loads hooks when a session starts. A brand-new session picks them up
  automatically; an already-running session may **not** hot-reload mid-session — restart it (or start
  a fresh session). After that, the next tool call makes the RPGDev window react.
- **Codex** may likewise need the session restarted to pick up new hooks.
- Start the window if it isn't open: `rpgdev` (macOS / Windows; on WSL2 it appears on the Windows host).
- If a hook can't reach the server it logs to `.rpgdev/hook-errors.log` and stderr (it never fails
  silently). An empty `hook-errors.log` after a few tool calls means it's working.

## Notes

- The generated command uses an **absolute path to node + the installed `scripts/rpg-hook.mjs`**, so it
  works without the package being on `PATH` and avoids the Windows `.cmd`-shim pitfall (Claude's
  exec-form hooks don't go through a shell). Run `rpgdev setup` **in the same environment the agent
  runs in** (native Windows vs WSL2) so the captured paths match.
- Codex cannot report tool failures via hooks, so the Codex config has no failure events (that's
  expected, not a bug).
- Windows + Codex only: if the inline command doesn't spawn on your machine, re-run with
  `rpgdev setup --codex --codex-cmd-wrap` to wrap it in `cmd /c`.
