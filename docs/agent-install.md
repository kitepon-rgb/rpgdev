# Install RPGDev — instructions for an AI coding agent

You are an AI coding agent (Claude Code, Codex, …) and your user said something like
**"read https://github.com/kitepon-rgb/rpgdev and install RPGDev for me."** Follow this file.

## Principle (how to decide what to do)

**Default to letting the scripts do the work.** Each step below is a script that does its part
automatically and *self-reports* the outcome. Your only judgment is per step: run the script, read
its report, and **do a manual step only when a script tells you it couldn't** (it always says why and
what to do instead). In practice the only inherently-manual point is the Windows admin firewall step
when you are on WSL2 — everything else the scripts handle.

RPGDev is distributed on npm; the user runs the **published package**. To update later:
`npm install -g rpgdev@latest`.

## Step 0 — read the environment

- Which agent are you wiring up: **Claude Code**, **Codex**, or both? (Default: the one you are.)
- Scope: **this project** (default) or **the whole machine** (`--user`, home-level config)?
- Platform: macOS / Windows / WSL2 / bare Linux.

## Step 1 — install the package

```
npm install -g rpgdev
```

## Step 2 — hooks (let the script write them)

Run `--apply` for the chosen provider/scope. It writes the hook config into the correct settings file
**safely**: it backs up the original, writes atomically, only touches `.hooks`, keeps the user's own
hooks, and is idempotent (re-running refreshes paths instead of duplicating).

```
rpgdev setup --apply --claude          # Claude Code, this project
rpgdev setup --apply --codex           # Codex, this project
rpgdev setup --apply --all             # both
rpgdev setup --apply --claude --user   # Claude Code, home-level (~/.claude/settings.json)
```

- Lines starting with `✓` mean it wrote them — you're done with this step.
- Lines starting with `!` (and a non-zero exit) mean it **refused to write automatically** because it
  couldn't do so safely (e.g. the existing settings file is invalid JSON, or has an unexpected shape).
  **Then, and only then, fall back to doing it yourself:** run `rpgdev setup --<provider>` (no
  `--apply`) to get the exact config + target path, and merge it by hand following the safety rules in
  [install-hooks.md](install-hooks.md) (touch only `.hooks`, keep existing hooks, back up first).

## Step 3 — firewall (Windows / WSL2 only)

The single hub runs on the Windows host; the host firewall must allow WSL2/Windows traffic to it.

```
rpgdev setup-firewall
```

- On the **Windows host** it applies a reboot-stable allow rule at both firewall layers (standard
  Defender + Hyper-V) after one UAC prompt — done.
- On **WSL2** it can't raise the UAC prompt it needs, so it will tell you to run it **on the Windows
  side**. Relay that to the user: *"run `rpgdev setup-firewall` once in a Windows terminal (it will ask
  for admin)."* This is the one admin-only step.
- If WSL2 still can't reach the hub afterward, a VPN kill-switch (e.g. NordVPN) may be blocking it —
  tell the user to allow LAN/local in the VPN. (macOS / bare Linux: skip this whole step.)

## Step 3b — Start Menu shortcut + tray (Windows / WSL2 only)

Add a Start Menu entry (Aqua-face icon) so the user has a manual launch point. No admin needed.

```
rpgdev setup-shortcut
```

- It builds the icon and creates `Start Menu\Programs\RPGDev.lnk` pointing at `rpgdev` — self-reports the
  path on success. Works from WSL2 too (it talks to Windows via interop). macOS / bare Linux: skip.
- A **system-tray icon** also appears automatically whenever the hub is running (launched alongside the
  window) — its presence tells the user the hub is up; right-click it for *Open window / Return to town /
  Quit*. There is nothing to install for the tray; this step only adds the Start Menu entry.

## Step 4 — launch and verify

```
rpgdev            # opens the desktop window (on WSL2 it appears on the Windows host)
```

- New hooks load in a **new** agent session — tell the user to restart Claude Code / Codex (or start a
  fresh session); a running session may not hot-reload.
- After that, the next tool call makes the window react. An empty `.rpgdev/hook-errors.log` after a few
  tool calls means it's working.

## Summary of what's automatic vs manual

| Step | Automatic (script) | Manual — only when the script says it can't |
| --- | --- | --- |
| install package | `npm i -g rpgdev` | — |
| hooks | `rpgdev setup --apply …` | existing settings file is invalid/odd → you merge per install-hooks.md |
| firewall (Win/WSL2) | `rpgdev setup-firewall` | on WSL2: user runs it once on the Windows side |
| Start Menu shortcut (Win/WSL2) | `rpgdev setup-shortcut` | — |
| launch | `rpgdev` | — |

bare Linux has no desktop window yet — use the browser view (`npm run web`).
