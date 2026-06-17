import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHookConfig, EVENT_SETS, RPGDEV_MARKER } from "../scripts/hook-config.mjs";

const NODE = "/usr/local/bin/node";
const SCRIPT = "/pkg/rpgdev/scripts/rpg-hook.mjs";

test("Claude: 9 events, each an exec-form node-abspath entry with the marker", () => {
  const cfg = buildHookConfig("claude", NODE, SCRIPT);
  const events = Object.keys(cfg.hooks);
  assert.equal(events.length, 9);

  for (const ev of events) {
    const entry = cfg.hooks[ev][0].hooks[0];
    assert.equal(entry.type, "command");
    assert.equal(entry.command, NODE);
    assert.deepEqual(entry.args, [SCRIPT, "claude", ev]);
    assert.equal(entry._rpgdev, RPGDEV_MARKER);
    assert.equal(typeof entry.timeout, "number");
    assert.equal(typeof entry.statusMessage, "string");
  }

  // matcher の有無と timeout を既存例どおりに
  assert.equal(cfg.hooks.PreToolUse[0].matcher, "*");
  assert.equal(cfg.hooks.UserPromptSubmit[0].matcher, undefined);
  assert.equal(cfg.hooks.UserPromptSubmit[0].hooks[0].timeout, 5);
  assert.equal(cfg.hooks.Stop[0].matcher, undefined);
});

test("Codex: exactly 6 events, no failure events, inline-string form", () => {
  const cfg = buildHookConfig("codex", NODE, SCRIPT);
  const events = Object.keys(cfg.hooks);
  assert.equal(events.length, 6);

  for (const bad of ["PostToolUseFailure", "PermissionDenied", "StopFailure"]) {
    assert.ok(!events.includes(bad), `codex must not include ${bad}`);
  }

  const entry = cfg.hooks.PreToolUse[0].hooks[0];
  assert.equal(entry.args, undefined);
  assert.equal(entry._rpgdev, RPGDEV_MARKER);
  assert.match(entry.command, /codex PreToolUse$/);
  assert.ok(entry.command.includes(`"${NODE}"`));
  assert.ok(entry.command.includes(`"${SCRIPT}"`));
});

test("codexCmdWrap prefixes `cmd /c` only on win32", () => {
  const wrapped = buildHookConfig("codex", NODE, SCRIPT, { codexCmdWrap: true, platform: "win32" });
  assert.ok(wrapped.hooks.PreToolUse[0].hooks[0].command.startsWith("cmd /c "));

  const plain = buildHookConfig("codex", NODE, SCRIPT, { codexCmdWrap: false, platform: "win32" });
  assert.ok(!plain.hooks.PreToolUse[0].hooks[0].command.startsWith("cmd /c "));

  const darwin = buildHookConfig("codex", NODE, SCRIPT, { codexCmdWrap: true, platform: "darwin" });
  assert.ok(!darwin.hooks.PreToolUse[0].hooks[0].command.startsWith("cmd /c "));
});

test("paths with spaces: Claude keeps a single arg, Codex double-quotes", () => {
  const n = "C:\\Program Files\\nodejs\\node.exe";
  const s = "C:\\Users\\My Name\\rpgdev\\scripts\\rpg-hook.mjs";

  const claude = buildHookConfig("claude", n, s);
  assert.deepEqual(claude.hooks.PreToolUse[0].hooks[0].args, [s, "claude", "PreToolUse"]);

  const codex = buildHookConfig("codex", n, s, { platform: "win32" });
  const cmd = codex.hooks.PreToolUse[0].hooks[0].command;
  assert.ok(cmd.includes(`"${n}"`));
  assert.ok(cmd.includes(`"${s}"`));
});

test("buildHookConfig is pure: same inputs -> deep-equal outputs", () => {
  assert.deepEqual(buildHookConfig("claude", NODE, SCRIPT), buildHookConfig("claude", NODE, SCRIPT));
});

test("unknown provider throws", () => {
  assert.throws(() => buildHookConfig("bogus", NODE, SCRIPT));
});

test("EVENT_SETS exposes the validated event names", () => {
  assert.equal(EVENT_SETS.claude.length, 9);
  assert.equal(EVENT_SETS.codex.length, 6);
});
