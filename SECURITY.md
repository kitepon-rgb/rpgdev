# Security Policy

RPGDev is a local developer tool for macOS, Windows, and WSL2. It turns
Codex / Claude Code hook events into a small RPG-style desktop overlay window.
It is not a network service and is not intended to be exposed beyond your own
machine (on Windows/WSL2 the single shared hub is reachable from the Windows
host and WSL2 only — see Attack Surface below).

## Supported Versions

Only the latest published version on npm receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.7.x (latest) | Yes |
| < 0.7.0 | No |

Please update to the latest release (`npm install -g rpgdev@latest`) before
reporting an issue.

## Attack Surface

RPGDev is designed to keep its attack surface small:

- **Loopback by default; `0.0.0.0` on Windows/WSL2.** On macOS and bare Linux
  the HTTP server binds `127.0.0.1:37373` (loopback) and is not reachable from
  the network. On Windows/WSL2 the single shared hub binds `0.0.0.0:37373` so
  the WSL2 side can reach the Windows host across the WSL adapter; inbound is
  gated by a Windows Defender rule scoped to the WSL NAT range
  (`172.16.0.0/12`) plus a matching Hyper-V firewall rule, and physical NICs
  stay blocked by default. The
  `/control/*` endpoints (including `/control/reset`, `/control/return-town`,
  and `/control/shutdown`, which the task tray uses to stop the hub) are
  **unauthenticated**, so on Windows/WSL2 this control surface is reachable from
  the WSL NAT range.
- **No network egress.** The tool makes no outbound network requests. All
  state stays in the project's local `.rpgdev/` directory.
- **Zero runtime dependencies.** The server and reducer use only the Node.js
  standard library, so there is no third-party dependency supply chain at
  runtime.
- **Local input only.** Hook payloads are read from stdin by the
  `rpgdev-hook` CLI and POSTed to the localhost server. The data comes from
  your own Codex / Claude Code sessions on the same machine.

The desktop window loads only local, bundled assets over the hub server: a
Swift `WKWebView` on macOS, and a C# WinForms `WebView2` window on Windows/WSL2.
On Windows/WSL2 a separate C# WinForms tray icon (no WebView2) is also launched;
it polls `/health` and offers Open window / Return to town / Quit (hub shutdown)
via the same unauthenticated `/control/*` endpoints.

## Reporting a Vulnerability

If you find a security issue, please report it privately:

- Open a **GitHub Security Advisory / private vulnerability report** on the
  repository:
  <https://github.com/kitepon-rgb/rpgdev/security/advisories/new>

For non-sensitive issues, you may instead open a regular issue:

- <https://github.com/kitepon-rgb/rpgdev/issues>

Please include the affected version, your OS / Node.js version, and steps to
reproduce.

## Response Expectations

This is a small, single-maintainer hobby project, so responses are
best-effort:

- Acknowledgement: typically within a few days.
- Fix for confirmed, valid issues: addressed in a following patch release on
  npm, prioritized by severity.

Thank you for helping keep RPGDev safe.
