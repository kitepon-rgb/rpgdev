#!/usr/bin/env node
// `rpgdev` のサブコマンド分岐。`setup` 以外は従来どおり desktop.mjs を起動する
// （`rpgdev` / `--from-hook` / `--build-only` は完全に従来挙動を維持）。
const sub = process.argv[2];

if (sub === "setup") {
  await import("./rpg-setup.mjs");
} else if (sub === "setup-firewall") {
  await import("./setup-firewall.mjs");
} else if (sub === "setup-shortcut") {
  await import("./setup-shortcut.mjs");
} else if (sub === "help" || sub === "--help" || sub === "-h") {
  process.stdout.write(
    [
      "rpgdev — RPG overlay for Codex / Claude Code hooks",
      "",
      "Usage:",
      "  rpgdev                  Open the desktop adventure window",
      "  rpgdev setup            Print the correct hook config for your AI agent to apply",
      "  rpgdev setup --apply    Write the hook config into your settings file automatically",
      "                          (safe: backs up, atomic, idempotent; refuses if it can't do it safely)",
      "  rpgdev setup-firewall   Allow WSL2 -> Windows-host on the hub port (Windows/WSL2 only; run on Windows)",
      "  rpgdev setup-shortcut   Add a Start Menu entry with the Aqua-face icon (Windows/WSL2 only)",
      "  rpgdev help             Show this help",
      "",
      "Easiest install: tell your AI agent \"read https://github.com/kitepon-rgb/rpgdev and install RPGDev\".",
      "It follows docs/agent-install.md — runs the auto scripts and only asks you for the few admin-only steps.",
      ""
    ].join("\n")
  );
} else {
  await import("./desktop.mjs");
}
