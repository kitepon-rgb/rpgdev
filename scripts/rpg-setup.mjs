#!/usr/bin/env node
// `rpgdev setup` — 正しいフック設定を「表示するだけ」のコマンド。
// 設定ファイルは書かない・編集しない・エージェントを起動しない。出力を利用者のエージェントへ渡すと、
// docs/install-hooks.md の安全規則に従って既存設定へマージしてくれる（手動コピーにも使える）。
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { detectPlatform } from "./desktop-platform.mjs";
import { buildHookConfig, hookTargetPath } from "./hook-config.mjs";

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOOK_SCRIPT = join(PACKAGE_ROOT, "scripts", "rpg-hook.mjs");
const RECIPE = join(PACKAGE_ROOT, "docs", "install-hooks.md");
const NODE_BIN = process.execPath; // 後でフックが走る環境と一致する node 実体の絶対パス

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

if (has("--help") || has("-h")) {
  printHelp();
  process.exit(0);
}

const platform = detectPlatform();
const wantClaude = has("--claude") || has("--all");
const wantCodex = has("--codex") || has("--all");
const providers = [];
if (wantClaude) providers.push("claude");
if (wantCodex) providers.push("codex");
if (providers.length === 0) providers.push("claude"); // 既定は Claude

const scope = has("--user") ? "user" : "project";
const jsonOnly = has("--json");
const codexCmdWrap = has("--codex-cmd-wrap");
const home = homedir();
const project = resolve(process.env.RPGDEV_PROJECT_DIR || process.cwd());

const blocks = providers.map((provider) => ({
  provider,
  target: hookTargetPath(provider, scope, { home, project }),
  config: buildHookConfig(provider, NODE_BIN, HOOK_SCRIPT, { codexCmdWrap, platform })
}));

if (jsonOnly) {
  const payload = blocks.length === 1 ? blocks[0].config : blocks.map(({ provider, config }) => ({ provider, config }));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  printForAgent(blocks);
}

function printForAgent(items) {
  const out = [];
  out.push("RPGDev hook setup");
  out.push("Hand this to your AI agent (it will merge it for you), or apply it by hand.");
  out.push("");

  for (const { provider, target, config } of items) {
    const label = provider === "claude" ? "Claude Code" : "Codex";
    out.push(`### ${label}  →  ${target}`);
    out.push("Merge the following into that file's \"hooks\" object (create the file if it does not exist):");
    out.push("");
    out.push(JSON.stringify(config, null, 2));
    out.push("");
  }

  out.push("Safe-merge rules (do not skip):");
  out.push("- Write to EXACTLY the file path shown above for each provider. (User-global Claude hooks go in");
  out.push("  ~/.claude/settings.json — NOT settings.local.json, which is project-only and ignored at user level.)");
  out.push("- Add only under \".hooks\". Never change permissions / env / model / mcpServers or any other key.");
  out.push("- For each event, KEEP existing hooks and APPEND the rpgdev entry. If an entry with");
  out.push("  \"_rpgdev\": \"rpgdev\" already exists for that event, update its path instead of duplicating.");
  out.push("- If the existing file is not valid JSON, STOP and ask the user — do not overwrite it.");
  out.push("- Back up the file before writing.");
  out.push("- New hooks take effect in a NEW agent session. An already-running Claude Code / Codex");
  out.push("  session may not hot-reload — restart it (or start a fresh session) so the hooks load.");
  out.push("");
  out.push(`Full recipe: ${RECIPE}`);
  out.push("Tip: --codex / --all for Codex, --user for the home-level config, --json for raw JSON.");

  process.stdout.write(`${out.join("\n")}\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "rpgdev setup — print the correct hook config to give your AI agent (or apply by hand).",
      "It only prints; it never edits your settings files.",
      "",
      "Usage: rpgdev setup [options]",
      "  --claude            Claude Code config (default)",
      "  --codex             Codex config",
      "  --all               both providers",
      "  --project           target the current project (default)",
      "  --user              target the home-level config (~)",
      "  --json              print raw JSON only (for piping)",
      "  --codex-cmd-wrap    wrap the Codex command with `cmd /c` (Windows escape hatch)",
      "  -h, --help          show this help",
      ""
    ].join("\n")
  );
}
