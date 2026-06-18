#!/usr/bin/env node
// `rpgdev setup` — 正しいフック設定を「表示するだけ」のコマンド。
// 設定ファイルは書かない・編集しない・エージェントを起動しない。出力を利用者のエージェントへ渡すと、
// docs/install-hooks.md の安全規則に従って既存設定へマージしてくれる（手動コピーにも使える）。
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { detectPlatform } from "./desktop-platform.mjs";
import { buildHookConfig, hookTargetPath } from "./hook-config.mjs";
import { applyHookConfig } from "./apply-hooks.mjs";

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
const applyMode = has("--apply"); // 設定ファイルへ安全に自動書込（できなければ表示へフォールバック）
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
} else if (applyMode) {
  await applyAll(blocks);
} else {
  printForAgent(blocks);
}

// `--apply`：各プロバイダの設定ファイルへ安全に自動書込する（apply-hooks の安全規則に従う）。
// 安全にできなかったもの（不正 JSON・想定外形状）は書かず、その理由と「表示＋手作業」への誘導を出す
// ＝AI が「自動で済んだ／ここだけ手作業」を判断できる出力。
async function applyAll(items) {
  const out = [];
  let anyDeferred = false;
  for (const { provider, target, config } of items) {
    const label = provider === "claude" ? "Claude Code" : "Codex";
    try {
      const result = await applyHookConfig(target, config);
      if (result.applied) {
        const change = result.added ? `added ${result.added}` : "";
        const upd = result.updated ? `updated ${result.updated}` : "";
        const detail = [change, upd].filter(Boolean).join(", ") || "no change";
        out.push(`✓ ${label}: hooks written to ${target} (${detail}).`);
        if (result.backupPath) out.push(`  backup: ${result.backupPath}`);
      } else {
        anyDeferred = true;
        out.push(`! ${label}: NOT written automatically — ${result.reason}`);
        out.push(`  Run \`rpgdev setup --${provider}${scope === "user" ? " --user" : ""}\` and merge it by hand (docs/install-hooks.md).`);
      }
    } catch (error) {
      anyDeferred = true;
      out.push(`! ${label}: apply failed — ${error.message}. Falling back to manual (run \`rpgdev setup --${provider}\`).`);
    }
  }
  out.push("");
  out.push("New hooks load in a NEW agent session — restart Claude Code / Codex (or start a fresh session).");
  if (platform === "wsl" || platform === "win32") {
    out.push("");
    out.push("Windows/WSL2 also needs the host firewall opened once — run `rpgdev setup-firewall` (on the Windows host).");
  }
  process.stdout.write(`${out.join("\n")}\n`);
  if (anyDeferred) process.exitCode = 2; // 一部は手作業＝AI が分岐できるよう非ゼロ
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

  if (platform === "wsl" || platform === "win32") {
    out.push("");
    out.push("Windows/WSL2 — open the host firewall once (the single hub lives on the Windows host):");
    out.push("  rpgdev setup-firewall");
    out.push("It applies a reboot-stable allow rule at both firewall layers (standard Defender + Hyper-V).");
    out.push("Run it on the WINDOWS host: from WSL2 the step can't raise the UAC prompt it needs.");
    out.push("Details: docs/windows-wsl.md.");
    out.push("");
    out.push("Windows/WSL2 — add a Start Menu entry with the Aqua-face icon (no admin needed):");
    out.push("  rpgdev setup-shortcut");
    out.push("A system-tray icon also appears automatically while the hub is running (= hub is up).");
  }

  out.push("");
  out.push(`Full recipe: ${RECIPE}`);
  out.push("Tip: add --apply to write it automatically (safe: backs up, atomic, idempotent; refuses if unsafe).");
  out.push("     --codex / --all for Codex, --user for the home-level config, --json for raw JSON.");

  process.stdout.write(`${out.join("\n")}\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "rpgdev setup — print the correct hook config to give your AI agent (or apply by hand).",
      "It only prints; it never edits your settings files.",
      "",
      "Usage: rpgdev setup [options]",
      "  --apply             write the config into the settings file automatically (safe; refuses if unsafe)",
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
