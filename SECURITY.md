# Security Policy

RPGDev is a local macOS developer tool. It turns Codex / Claude Code hook
events into a small RPG-style desktop overlay window. It is not a network
service and is not intended to be exposed beyond your own machine.

## Supported Versions

Only the latest published version on npm receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.5.x (latest) | Yes |
| < 0.5.0 | No |

Please update to the latest release (`npm install -g rpgdev@latest`) before
reporting an issue.

## Attack Surface

RPGDev is designed to keep its attack surface small:

- **Localhost only.** The HTTP server binds to `127.0.0.1:37373` (loopback).
  It does not listen on any external interface and is not reachable from the
  network.
- **No network egress.** The tool makes no outbound network requests. All
  state stays in the project's local `.rpgdev/` directory.
- **Zero runtime dependencies.** The server and reducer use only the Node.js
  standard library, so there is no third-party dependency supply chain at
  runtime.
- **Local input only.** Hook payloads are read from stdin by the
  `rpgdev-hook` CLI and POSTed to the localhost server. The data comes from
  your own Codex / Claude Code sessions on the same machine.

The desktop window is a Swift `WKWebView` that loads only local,
bundled assets over the loopback server.

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
