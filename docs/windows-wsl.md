# Windows / WSL2 support

RPGDev's desktop window started life as a macOS-only Swift + WKWebView host. As of
v0.6, the same overlay also runs on **Windows** (native) and inside **WSL2** (the
window appears on the Windows host). Everything except the window — the server, the
hook CLI, the reducer, BGM/SFX generation, the web front-end — was already
cross-platform; only the desktop window needed a per-platform host.

> **Status / honesty note.** The Windows and WSL2 paths are authored to mirror the
> macOS host, but they are **not yet verified on a real Windows/WSL2 machine** by the
> maintainers. The macOS path is unchanged and remains the reference. If anything
> below fails, it surfaces a clear error (no silent fallback) — please file it.

## Platform matrix

| Platform | Window host | How it is built | Notes |
| --- | --- | --- | --- |
| macOS | Swift + WKWebView | `swiftc` on demand → `.rpgdev/RPGDev.app` | unchanged reference path |
| Windows (native) | C# WinForms + WebView2 | `csc.exe` on demand → `.rpgdev/RPGDevWin/RPGDev.exe` | needs WebView2 runtime + the SDK DLLs below |
| WSL2 | C# WinForms + WebView2 on the **Windows host** | `csc.exe` via interop → `%LOCALAPPDATA%\rpgdev\<hash>\RPGDev.exe` | server runs in WSL2; window runs on the host |
| bare Linux | — | — | desktop window not supported; use `npm run web` (browser view) |

The platform is chosen by `scripts/desktop-platform.mjs` (`detectPlatform()`):
`darwin` / `win32` / `wsl` (linux + `/proc/version` contains `microsoft`, or
`WSL_DISTRO_NAME` / `WSL_INTEROP` is set) / `linux`. `scripts/desktop.mjs`
dispatches on it.

## Requirements (Windows host)

1. **WebView2 Evergreen Runtime.** Preinstalled on Windows 11 and on most Windows 10
   machines. If missing, install the bootstrapper from Microsoft (search
   "Download WebView2 Runtime").
2. **.NET Framework 4.x C# compiler (`csc.exe`).** Ships with Windows at
   `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`. Install .NET Framework
   4.8 (or VS Build Tools) if absent.
3. **Node.js 20+** (for the hook CLI / server, same as every platform).

The **WebView2 SDK DLLs are bundled** in `desktop/webview2/` (no manual download).

### WebView2 SDK DLLs (`desktop/webview2/`) — bundled

The C# host creates the WebView2 controller directly on the window handle, so it needs
exactly **two** files, both of which ship with RPGDev (no WinForms/WPF wrapper
assembly, no bundled Chromium — the Evergreen runtime does the actual rendering):

- `Microsoft.Web.WebView2.Core.dll` — managed Core wrapper (AnyCPU, .NET Framework
  4.6.2 target).
- `WebView2Loader.dll` — native loader, **x64**.

Microsoft's [distribution docs](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#files-to-ship-with-the-app)
explicitly require shipping these two with the app, so they are committed to the repo
(and included in the npm package). See `desktop/webview2/README.md` for the source
package version and how to update them. If they are ever removed, the build stops with
a clear error (it does not silently skip the window).

> arm64 Windows: swap in the `win-arm64` `WebView2Loader.dll` and change
> `/platform:x64` to `/platform:arm64` in `scripts/desktop.mjs` (deferred / untested).

## How the Windows window is built and launched

`npm start` (or the `UserPromptSubmit` hook → `node scripts/desktop.mjs --from-hook`):

1. `detectPlatform()` → `win32`.
2. `buildWinWindowIfNeeded()` — copies the two DLLs next to the exe, then compiles
   `desktop/RPGDevWindow.cs` with `csc.exe` to `.rpgdev/RPGDevWin/RPGDev.exe`
   **only if the source is newer** (same mtime check as the Swift path).
3. Launch `RPGDev.exe http://127.0.0.1:37373/overlay.html <webview2-data> <state.json> <instanceKey>`.
4. A named `Mutex` inside the host enforces a single window: a second launch brings
   the existing window to the foreground and exits. `npm run build:desktop` just
   compiles and exits.

Runtime state stays under the project's `.rpgdev/`: `RPGDevWin/RPGDev.exe`,
`webview2-data/` (WebView2 user-data dir), `desktop-window-win.json` (window
position/size, keyed by a display signature — reset when monitors change, exactly like
the macOS `UserDefaults` logic).

### Window behaviour & v1 limitations

- **Always-on-top**, **no taskbar button**, **4:3** aspect kept on resize, min client
  512×384, position restored across restarts.
- **Resize quality.** Two separate concerns are handled:
  - *Flicker* — the host uses **Window-to-Visual hosting**
    (`COREWEBVIEW2_FORCED_HOSTING_MODE=COREWEBVIEW2_HOSTING_MODE_WINDOW_TO_VISUAL`) so
    the page composes through a DirectComposition visual instead of a child HWND.
  - *Pixel-art sharpness* — the window fit uses **ZoomFactor re-rasterization**
    (`BoundsMode=UseRawPixels`, `RasterizationScale=1`, integer `ZoomFactor`) plus the
    overlay's existing `image-rendering: pixelated`, with **integer-multiple scaling +
    letterbox**. This avoids "scale a pre-rasterized surface" blur; sprites resample
    once from their high-res sources.
- **Audio.** No native audio bridge on Windows. BGM plays from the same
  `/audio/*.wav` files via the overlay's `<audio loop>` elements (identical to the
  macOS native audio). SFX are **WebAudio-synthesized** (the macOS native path plays
  the rendered SFX WAVs; on Windows they are synthesized — functionally complete, a
  touch different). Autoplay is enabled with
  `--autoplay-policy=no-user-gesture-required`; if your runtime still blocks it, click
  the `♪` button once.
- **Transparency.** v1 keeps a normal titled window; letterbox bars are black. A
  frameless, per-pixel-transparent desktop overlay (matching the macOS see-through
  look) is deferred.

### Hook setup (Windows native)

The setup flow is the same on every platform: ask your AI agent to set it up (it runs
`rpgdev setup` and merges the result), or run `rpgdev setup` yourself and copy the printed
config. See [install-hooks.md](install-hooks.md). The target is
`<project>\.claude\settings.local.json` or `%USERPROFILE%\.claude\settings.local.json`
(Claude Code), or your Codex hooks file.

**Why `rpgdev setup` matters specifically on Windows:** the generated Claude config is exec
form (`"command": "<node.exe>", "args": ["<…>\\rpg-hook.mjs", "claude", "<Event>"]`). Claude
Code spawns exec-form hooks **without a shell**, so a bare `"command": "rpgdev-hook"` does
*not* resolve the `rpgdev-hook.cmd` PATH shim — the hook silently never fires. The
absolute-path-to-node form sidesteps that entirely (no `PATH`, no `.cmd` shim). Run
`rpgdev setup` in the environment the agent runs in (native Windows here) so the captured
paths are the Windows ones.

- **Codex (native Windows)** — uses the same absolute-node inline form. If Codex on your
  machine doesn't spawn it, re-run with `rpgdev setup --codex --codex-cmd-wrap` to wrap it as
  `cmd /c …` (real-device verification still welcome).

> The static `examples\*.json` remain for manual copying but assume a global install. The
> `examples\claude-settings.local.json` shell form (single `command` string, no `args`) lets the
> shell resolve the `.cmd` shim — that's the manual-copy fallback, not the exec form above.

## WSL2 (developer in Linux, window on the Windows host)

When Claude Code / Codex run **inside WSL2**, the hook runs in Linux, the server runs
in WSL2, but the window must appear on the **Windows host**. RPGDev does this
automatically:

1. `detectPlatform()` → `wsl`.
2. The server starts in WSL2 (Linux Node), listening on `127.0.0.1:37373`.
3. `scripts/desktop.mjs` builds the Windows host **via interop**: it reads
   `%LOCALAPPDATA%` (`cmd.exe`), creates a Windows-local cache
   `%LOCALAPPDATA%\rpgdev\<hash>\`, copies `RPGDevWindow.cs` + the two WebView2 DLLs
   there, and compiles with the Windows `csc.exe` (found under `/mnt/c/Windows/...`),
   passing Windows paths translated with `wslpath`.
4. It launches `RPGDev.exe` on the host (interop runs the `.exe`), pointed at
   `http://localhost:37373/overlay.html`.

### WSL2 requirements

- **`.wslconfig localhostForwarding=true`** (the default). This is what lets the
  Windows-host window reach the WSL2 server at `localhost:37373`. In
  `%UserProfile%\.wslconfig`:

  ```ini
  [wsl2]
  localhostForwarding=true
  ```

- The **Windows host** must have the WebView2 runtime, `csc.exe`, and the same
  `desktop/webview2/` DLLs (they ship in the package, which is installed inside WSL2;
  the build copies them across).
- **WSL interop enabled** (the default) so `cmd.exe` / `csc.exe` / the built `.exe` are
  runnable from Linux.

The Windows-side runtime (exe, DLLs, `webview2-data/`, `window.json`) lives in
`%LOCALAPPDATA%\rpgdev\<hash>\` — not under the project `.rpgdev/` — because the window
is a Windows process and running an exe / WebView2 cache off the `\\wsl$` share is
fragile.

### WSL2 hooks

No new config: Claude/Codex run inside WSL2, so the **existing Linux examples**
(`examples/claude-settings.local.json`, `examples/codex-hooks.json`) are used
unchanged at `~/.claude/settings.local.json` / your Codex hooks path.

### Networking / security

Keep `RPGDEV_HOST=127.0.0.1` (the default). With `localhostForwarding`, the Windows
host reaches it. **Do not** default to `0.0.0.0`: the hook server exposes unauthenticated
`/hook` and `/control/reset`, so a wider bind would expose game-state mutation to the
LAN. Only set `RPGDEV_HOST=0.0.0.0` if `localhostForwarding` is unavailable and you
understand the exposure.

## Verification checklist (real Windows / WSL2 box)

These cannot be validated on macOS and must be checked on a real machine:

- [ ] `npm run build:desktop` compiles the exe (the WebView2 DLLs are bundled).
- [ ] Window: transparent/black content, always-on-top, no taskbar button, 4:3 on
      resize, min size, position restored after restart and reset on display change.
- [ ] Resize: no flicker (Window-to-Visual); pixel-art edges stay crisp at various
      sizes (ZoomFactor + integer letterbox). Confirm on your WebView2 runtime version
      (some versions have had composition resize regressions — pin a fixed-version
      runtime if needed).
- [ ] BGM autostarts (autoplay arg); SFX synthesize; `♪` toggles.
- [ ] Single instance: two `UserPromptSubmit` hooks in quick succession → one window.
- [ ] Hooks: Claude/Codex resolve `rpgdev-hook`, POST succeeds, window opens on
      `UserPromptSubmit`.
- [ ] WSL2: server reachable at `localhost:37373` from the host; interop build +
      launch works; `.wslconfig localhostForwarding=true`.
