#!/usr/bin/env node
// `rpgdev` のサブコマンド分岐。`setup` 以外は従来どおり desktop.mjs を起動する
// （`rpgdev` / `--from-hook` / `--build-only` は完全に従来挙動を維持）。
const sub = process.argv[2];

if (sub === "setup") {
  await import("./rpg-setup.mjs");
} else if (sub === "help" || sub === "--help" || sub === "-h") {
  process.stdout.write(
    [
      "rpgdev — RPG overlay for Codex / Claude Code hooks",
      "",
      "Usage:",
      "  rpgdev            Open the desktop adventure window",
      "  rpgdev setup      Print the correct hook config to give your AI agent (or apply by hand)",
      "  rpgdev help       Show this help",
      "",
      "Hook setup: ask your AI agent to \"set up RPGDev hooks\" (see docs/install-hooks.md),",
      "or run `rpgdev setup` and copy the printed config.",
      ""
    ].join("\n")
  );
} else {
  await import("./desktop.mjs");
}
