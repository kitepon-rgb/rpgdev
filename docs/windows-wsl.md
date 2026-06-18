# Windows / WSL2 support

RPGDev's desktop window started life as a macOS-only Swift + WKWebView host. As of
v0.6, the same overlay also runs on **Windows** (native) and inside **WSL2** (the
window appears on the Windows host). Everything except the window — the server, the
hook CLI, the reducer, BGM/SFX generation, the web front-end — is cross-platform; only
the desktop window needs a per-platform host, and on Windows/WSL2 the **single shared
hub** runs on the Windows host (see below).

> **Status / honesty note.** The single-hub WSL2 path is **verified end-to-end on a real
> WSL2 box** (Ubuntu 26.04): a Windows-host server (local files, `0.0.0.0`) + a
> localhost-connected window + WSL2 hooks → the window correctly renders Explore (field),
> a battle (encounter→defeat), and Clear (town + resting hero). The macOS path is
> unchanged and remains the reference. Everything surfaces a clear error on failure (no
> silent fallback) — please file anything that breaks.

## The single Windows hub (one server, one window, one adventure)

If you run RPGDev across **both** a native-Windows project and a WSL2 project (or two of
either), they do **not** each spin up their own server and window. That used to cause
three problems: both sides fought over port 37373, two windows appeared, and the WSL2
window could connect to the wrong server. Instead:

- **One hub.** Exactly one `node` server runs, **on the Windows host**, started from
  **Windows-local files** and bound to **`0.0.0.0`**. Binding all interfaces lets both the
  host window (`localhost`) and WSL2 (the host's WSL-adapter IP) reach the same server.
  The physical NIC stays closed by Windows Defender's default inbound block, so only
  loopback and the WSL `vEthernet` adapter (one inbound allow rule, below) actually reach
  it — no token, no real LAN exposure.
- **One window.** The C# host's single-instance `Mutex` uses a fixed key (`rpgdev-hub`) in
  the **`Global\` namespace with an Everyone-allow ACL**, so the dedup crosses Windows
  sessions: a Windows-native launch and a WSL2-interop launch can land in *different*
  Terminal-Services sessions, and a session-scoped `Local\` mutex would let each think it is
  first and open its own window (two windows). `Global\`+ACL makes whoever launches second
  just bring the existing window forward (it falls back to `Local\` only if `Global\` can't
  be created). The window always connects via **`localhost:37373`** (it is always on the
  same host as the hub).
- **One adventure / one state.** The hub's state lives in a single global directory
  (`%LOCALAPPDATA%\rpgdev\hub`), so all tool use — Windows or WSL2 — drives the same
  monsters, quests, and stages. Ownership of the quest list is decided by the reducer's
  existing multi-session arbitration (`ownerSession`).
- **Order-independent.** Set up Windows first or WSL2 first — both converge on the same
  reachable hub. Hook configs never bake in an address; each side resolves it at runtime
  via `scripts/hub-net.mjs`.

`scripts/hub-net.mjs` resolves three *purpose-specific* addresses (mixing them is what
broke earlier attempts):

| helper | meaning | win32 | wsl | darwin/linux |
| --- | --- | --- | --- | --- |
| `hubBindHost` | address the server listens on (`RPGDEV_HOST` env) | `0.0.0.0` | `0.0.0.0` | `127.0.0.1` |
| `hubReachHost` | where *this process* reaches the hub (hook POST / health) | `127.0.0.1` | gateway (host's WSL-adapter IP) | `127.0.0.1` |
| `HUB_WINDOW_HOST` | where the **window** connects | `127.0.0.1` | `127.0.0.1` | `127.0.0.1` |

So: the server listens on everything, the window always talks to `localhost`, and only
WSL2 hooks use the gateway IP. The port-collision / two-windows / wrong-server class of
bugs is **designed out**, not patched.

> **Run the server from local files, never off the `\\wsl.localhost` share.** When the
> WSL2 path starts the hub, it **copies `server/` and `public/` into
> `%LOCALAPPDATA%\rpgdev\hub` and runs that copy** with the host `node.exe`. Running the
> server script *directly* from the `\\wsl.localhost\<distro>\…` share makes the host
> WebView2 unable to receive the SSE stream (`/events`) — the window loads static assets
> but never gets live updates (background stuck, no BGM). Local-file execution (the same
> shape as a native-Windows server) fixes it. This is verified.

## Platform matrix

| Platform | Window host | How it is built | Notes |
| --- | --- | --- | --- |
| macOS | Swift + WKWebView | `swiftc` on demand → `.rpgdev/RPGDev.app` | unchanged reference path |
| Windows (native) | C# WinForms + WebView2 | `csc.exe` on demand → `%LOCALAPPDATA%\rpgdev\hub\RPGDevWin\RPGDev.exe` | hub binds `0.0.0.0`; window connects `localhost` |
| WSL2 | C# WinForms + WebView2 on the **Windows host** | `csc.exe` via interop → `%LOCALAPPDATA%\rpgdev\hub\RPGDev.exe` | hub server (local-copied) + window both on the host; WSL2 hooks reach it via the gateway IP |
| bare Linux | — | — | desktop window not supported; use `npm run web` (browser view) |

The platform is chosen by `scripts/desktop-platform.mjs` (`detectPlatform()`):
`darwin` / `win32` / `wsl` (linux + `/proc/version` contains `microsoft`, or
`WSL_DISTRO_NAME` / `WSL_INTEROP` is set) / `linux`. `scripts/desktop.mjs`
dispatches on it.

## Requirements (Windows host)

1. **WebView2 Evergreen Runtime.** Preinstalled on Windows 11 and most Windows 10
   machines. If missing, install the bootstrapper from Microsoft.
2. **.NET Framework 4.x C# compiler (`csc.exe`).** Ships with Windows at
   `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`.
3. **Node.js 20+ on the Windows host.** Required for native Windows *and* for WSL2: in
   the single-hub model the server **runs on the host**, so the host needs `node.exe`
   (the WSL2 path finds it via `where node`, else `C:\Program Files\nodejs\node.exe`).
   Node inside WSL2 still runs the hook CLI.

The **WebView2 SDK DLLs are bundled** in `desktop/webview2/` (no manual download).

### WebView2 SDK DLLs (`desktop/webview2/`) — bundled

The C# host creates the WebView2 controller directly on the window handle, so it needs
exactly **two** files, both shipped with RPGDev:

- `Microsoft.Web.WebView2.Core.dll` — managed Core wrapper (AnyCPU, .NET Framework 4.6.2).
- `WebView2Loader.dll` — native loader, **x64**.

Microsoft's [distribution docs](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#files-to-ship-with-the-app)
require shipping these two with the app, so they are committed to the repo (and the npm
package). If removed, the build stops with a clear error.

> arm64 Windows: swap in the `win-arm64` `WebView2Loader.dll` and change `/platform:x64`
> to `/platform:arm64` in `scripts/desktop.mjs` (deferred / untested).

## How the Windows window is built and launched (native)

`npm start` (or the `UserPromptSubmit` hook → `node scripts/desktop.mjs`):

1. `detectPlatform()` → `win32`.
2. `ensureServer()` starts the hub locally with `RPGDEV_HOST=0.0.0.0` and
   `RPGDEV_PROJECT_DIR=%LOCALAPPDATA%\rpgdev\hub`. If a hub already serves, it is a no-op.
3. `buildWinWindowIfNeeded()` compiles `desktop/RPGDevWindow.cs` to
   `%LOCALAPPDATA%\rpgdev\hub\RPGDevWin\RPGDev.exe` (mtime-gated).
4. Launch `RPGDev.exe http://127.0.0.1:37373/overlay.html <webview2-data> <state.json> rpgdev-hub`.
5. The fixed `rpgdev-hub` `Mutex` (in the `Global\` namespace, Everyone-allow ACL) enforces a
   single window **across sessions** (so a WSL2-interop launch and a Windows-native launch
   share one window); a second launch foregrounds the existing one. `npm run build:desktop`
   just compiles and exits.

Hub runtime state lives in **`%LOCALAPPDATA%\rpgdev\hub`** — `RPGDevWin/RPGDev.exe`,
`webview2-data/`, `desktop-window-win.json`, and the server's `state.json` /
`events.ndjson` / `playback.ndjson`. Only per-launch **error logs** stay in the project's
own `.rpgdev/`.

### Window behaviour & v1 limitations

- **Always-on-top**, **no taskbar button**, **4:3** kept on resize, min client 512×384,
  position restored across restarts.
- **Resize quality.** *Flicker* — Window-to-Visual hosting
  (`COREWEBVIEW2_FORCED_HOSTING_MODE=…WINDOW_TO_VISUAL`). *Pixel-art sharpness* —
  ZoomFactor re-rasterization (`BoundsMode=UseRawPixels`, `RasterizationScale=1`, integer
  `ZoomFactor`) + `image-rendering: pixelated` + integer-multiple scaling + letterbox.
- **Audio.** No native bridge on Windows. BGM and SFX both play through the overlay's
  `<audio>` elements (the unified `<audio>` path as of v0.6.5; macOS uses `AVAudioPlayer`).
  Autoplay via `--autoplay-policy=no-user-gesture-required`; if blocked, click `♪` once.
- **Transparency.** v1 keeps a normal titled window; letterbox bars are black. A
  frameless per-pixel-transparent overlay is deferred.

### Task-tray resident (Windows / WSL2)

Alongside the window, `scripts/desktop.mjs` also builds and launches a small **task-tray
resident** (`desktop/RPGDevTray.cs` → `RPGDevTray.exe`, C# WinForms `NotifyIcon`, **no
WebView2**). Its job is to make hub liveness visible: it polls `GET /health` every **3s** and
removes **itself** after **3 consecutive failures**, so **tray icon present = hub running,
gone = hub stopped**. The icon is the **water-spirit Aqua face**, cropped at runtime from
`public/assets/sprites/ally-water-facing-slit.png` via `System.Drawing` (no external image
tool; `--make-ico` also writes a PNG-in-ICO). Right-click menu: **Open window** / **Return to
town** (`POST /control/return-town`) / **Quit** which stops the hub (`POST /control/shutdown`).
Single instance is a file lock `rpgdev-hub.tray.lock` in the hub dir (separate from the
window's `Global\` mutex). Note: **Windows hides newly-added tray icons in the overflow (`^`)
by default** — drag it out to keep it visible.

### Hook setup (Windows native)

Same on every platform: ask your AI agent to set it up (it runs `rpgdev setup` and merges
the result), or run `rpgdev setup` yourself. See [install-hooks.md](install-hooks.md). The
target is `<project>\.claude\settings.local.json` or `%USERPROFILE%\.claude\settings.json`
(Claude Code user-global), or your Codex hooks file.

**Why `rpgdev setup` matters on Windows:** the Claude config is exec form
(`"command": "<node.exe>", "args": ["<…>\\rpg-hook.mjs", …]`). Claude Code spawns exec-form
hooks **without a shell**, so a bare `"command": "rpgdev-hook"` does *not* resolve the
`rpgdev-hook.cmd` PATH shim — the hook silently never fires. The absolute-node form
sidesteps that. Run `rpgdev setup` in the environment the agent runs in.

> The static `examples\*.json` remain for manual copying but assume a global install.

### Start Menu shortcut (Windows / WSL2)

`rpgdev setup-shortcut` adds a Start Menu entry so the hub can be launched without a
terminal. It writes `%APPDATA%\Microsoft\Windows\Start Menu\Programs\RPGDev.lnk` with the
Aqua-face `rpgdev.ico` (generated under `%LOCALAPPDATA%\rpgdev\hub` by the tray exe's
`--make-ico` mode); the shortcut target launches `rpgdev`. **No admin needed**, and it works
from **WSL2 via interop**. On macOS / bare Linux it is a no-op (skipped).

## WSL2 (developer in Linux, hub + window on the Windows host)

When Claude Code / Codex run **inside WSL2**, the hook runs in Linux, but both the **hub
server and the window run on the Windows host** — WSL2 does not run its own server. The
WSL2 side resolves the host's WSL-adapter IP (its default gateway) for hooks, and the
window connects via `localhost`. Automatically:

1. `detectPlatform()` → `wsl`.
2. `ensureWindowsHubFromWsl()` makes sure the hub is up **on the host**: it checks
   `http://<gateway>:37373/health`, and if nothing answers it **copies `server/` and
   `public/` into `%LOCALAPPDATA%\rpgdev\hub`** (via `wslpath`-translated paths) and starts
   that copy with the host `node.exe` (`where node`, else `C:\Program Files\nodejs`).
   Env crosses the WSL→Windows boundary via **`WSLENV`**: `RPGDEV_HOST=0.0.0.0`,
   `RPGDEV_PORT`, `RPGDEV_PROJECT_DIR=%LOCALAPPDATA%\rpgdev\hub`. It waits for `/health`
   (on the gateway IP) before continuing. *(The hook CLI delegates this to
   `node scripts/desktop.mjs --ensure-hub`.)*
3. The window is built on the host via interop (`csc.exe`), into `%LOCALAPPDATA%\rpgdev\hub`.
4. It launches `RPGDev.exe` pointed at **`http://127.0.0.1:37373/overlay.html`** — the
   window is on the host, so it talks to the hub over `localhost` (the same `0.0.0.0` hub
   that WSL2 hooks reach via the gateway IP).

> **WSLENV is required.** Only variables listed in `WSLENV` cross into the
> interop-spawned Windows process. Without it the host `node.exe` falls back to its
> defaults and the shared hub never comes up correctly.
>
> **Why copy instead of running off the share.** Running `server/rpgdev-server.mjs`
> straight from `\\wsl.localhost\…` makes the host WebView2 unable to receive `/events`
> (SSE) — the window shows static art but never updates. Copying to local files fixes it
> (verified). `server/` is small; `public/` is a few MB and is copied mtime-gated.

### WSL2 requirements

- **A Windows-host firewall rule allowing WSL→host inbound on the hub port** (see
  "Firewall" below) — the one external dependency. Needed even with `0.0.0.0`, because
  Defender's *default* inbound block otherwise drops the WSL `vEthernet` traffic.
- **Node.js on the Windows host** (the hub runs there), plus the WebView2 runtime,
  `csc.exe`, and the bundled `desktop/webview2/` DLLs (copied across by the build).
- **WSL interop enabled** (default) so `cmd.exe` / `csc.exe` / the host `node.exe` / the
  built `.exe` run from Linux.
- **`localhostForwarding` is not required.** The window connects to the hub over
  `localhost` on the *same host*, and WSL2 reaches it over the gateway IP — nothing relies
  on the Windows→WSL `localhostForwarding` mechanism. Keeping the default is harmless.

> **Mirrored networking mode.** This is for the default **NAT** mode. Under
> `networkingMode=mirrored` host and WSL2 share `localhost` with no separate gateway —
> set `RPGDEV_HOST=127.0.0.1` so both sides resolve the same loopback hub.

### Firewall (the one thing you may have to do by hand)

The single hub lives on the Windows host, so the host firewall must allow WSL2→host inbound
on the hub port. **The easy, correct way is `rpgdev setup-firewall`** — run it **on the
Windows host** (it asks for admin once). It applies a **reboot-stable** allow rule at **both
firewall layers**:

- **Standard Windows Defender Firewall.** WSL2→host arrives on the host's `vEthernet (WSL …)`
  adapter as **inbound**, which Defender blocks by default. The rule is scoped by the WSL NAT
  **source range `-RemoteAddress 172.16.0.0/12`**, *not* by `-InterfaceAlias`: scoping by
  interface bakes the WSL adapter's **GUID** into the saved rule, and that GUID changes on
  every reboot, so an interface-scoped rule silently stops matching after a restart (hit on a
  real box, 2026-06-18). The NAT range is stable and still host-only — LAN/VPN are outside it.
- **Hyper-V firewall.** On builds that expose `New-NetFirewallHyperVRule`, the WSL vmCreator's
  **default inbound is Block**, so a matching allow rule is added there too. If *either* layer
  blocks, the hub is unreachable — that is why both are needed.

**From WSL2 you can't raise the UAC prompt** the change needs, so `rpgdev setup-firewall` run
inside WSL2 just tells you to run it on the Windows side (and exits non-zero so an agent can
branch). Verify from inside WSL2:
`curl http://$(ip route show default | grep -oE '([0-9]+\.){3}[0-9]+' | head -1):37373/health`
should return `{"ok":true,...}`. If it still fails, a VPN kill-switch (e.g. NordVPN) may be
blocking it — allow LAN/local in the VPN, or run `wsl --shutdown` from Windows to refresh
networking.

### WSL2 hooks

No new config and no baked-in address: the hook resolves the hub IP at runtime
(`hubReachHost()`), so the **existing Linux examples** — or `rpgdev setup` — are used
unchanged at `~/.claude/settings.local.json` / your Codex hooks path. The same configs
work whether you set up Windows first or WSL2 first.

### Networking / security

The hub binds **`0.0.0.0`** so the host window (`localhost`) and WSL2 (the gateway IP) can
both reach it. That is *not* a LAN exposure in practice: Windows Defender's default
inbound block keeps the physical NIC closed, and the only inbound allow rule is scoped to
the WSL NAT source range (`-RemoteAddress 172.16.0.0/12`). So the unauthenticated `/hook` and
the `/control/*` endpoints (e.g. `/control/reset`, and the tray's `/control/return-town` /
`/control/shutdown`) are reachable only from the host itself and from WSL2 — which is why
**no token is needed**. The window never uses a non-loopback address, so there is
no WebView2-to-private-IP fragility.

## Verification checklist (real Windows / WSL2 box)

Verified on a real WSL2 box (the first three); the rest still wants eyes on a real machine:

- [x] WSL2 → host reachability: `curl http://<gateway>:37373/health` returns `{"ok":true}`
      (needs the firewall rule above).
- [x] `node scripts/desktop.mjs --ensure-hub` from WSL2 reuses a running hub (no-op) and,
      from cold, copies `server/`+`public/` locally and starts a `0.0.0.0` hub.
- [x] WSL2 tool use drives the window: Explore (field bg), encounter→defeat, and Clear
      (town bg + resting hero) render with correct backgrounds/sprites and BGM/SFX.
- [ ] `npm run build:desktop` compiles the exe (the WebView2 DLLs are bundled).
- [ ] Window chrome: always-on-top, no taskbar button, 4:3 on resize, min size, position
      restored, reset on display change.
- [ ] Resize: no flicker; pixel-art edges stay crisp (confirm on your WebView2 version).
- [ ] Single instance: a Windows launch and a WSL2 launch → **one** window (`rpgdev-hub`).
- [ ] Order independence: Windows-first then WSL2, and WSL2-first then Windows.
- [ ] Hooks: Claude/Codex resolve `rpgdev-hook`, POST succeeds, window opens on
      `UserPromptSubmit`.
