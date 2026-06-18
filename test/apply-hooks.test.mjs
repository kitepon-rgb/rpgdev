import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeHooks, applyHookConfig } from "../scripts/apply-hooks.mjs";
import { buildHookConfig } from "../scripts/hook-config.mjs";

const CONFIG = buildHookConfig("claude", "/usr/bin/node", "/pkg/scripts/rpg-hook.mjs");

test("mergeHooks adds rpgdev hooks under .hooks and preserves other top-level keys", () => {
  const existing = { permissions: { allow: ["Bash"] }, env: { FOO: "bar" } };
  const { merged, added } = mergeHooks(existing, CONFIG);
  assert.deepEqual(merged.permissions, { allow: ["Bash"] }, "permissions untouched");
  assert.deepEqual(merged.env, { FOO: "bar" }, "env untouched");
  assert.ok(merged.hooks.UserPromptSubmit, "rpgdev hook added");
  assert.ok(added > 0);
});

test("mergeHooks keeps the user's existing hooks for an event and appends rpgdev (no replace)", () => {
  const userEntry = { matcher: "*", hooks: [{ type: "command", command: "my-own-hook" }] };
  const existing = { hooks: { PreToolUse: [userEntry] } };
  const { merged } = mergeHooks(existing, CONFIG);
  assert.equal(merged.hooks.PreToolUse.length, 2, "user entry kept + rpgdev appended");
  assert.deepEqual(merged.hooks.PreToolUse[0], userEntry, "user's own hook preserved as-is");
  assert.ok(
    merged.hooks.PreToolUse.some((w) => w.hooks.some((h) => h._rpgdev === "rpgdev")),
    "rpgdev entry present"
  );
});

test("mergeHooks is idempotent: re-merging updates the rpgdev entry in place (no duplicate)", () => {
  const first = mergeHooks({}, CONFIG).merged;
  const newPath = buildHookConfig("claude", "/usr/bin/node", "/NEW/path/rpg-hook.mjs");
  const { merged, added, updated } = mergeHooks(first, newPath);
  assert.equal(merged.hooks.PreToolUse.length, 1, "no duplicate rpgdev entry");
  assert.equal(added, 0, "nothing added on re-merge");
  assert.ok(updated > 0, "existing rpgdev entries updated");
  const cmd = merged.hooks.PreToolUse[0].hooks[0];
  assert.deepEqual(cmd.args, ["/NEW/path/rpg-hook.mjs", "claude", "PreToolUse"], "path refreshed");
});

test("applyHookConfig creates a new settings file when none exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rpgdev-apply-"));
  try {
    const target = join(dir, ".claude", "settings.json");
    const result = await applyHookConfig(target, CONFIG);
    assert.equal(result.applied, true);
    assert.equal(result.backupPath, null, "no backup for a brand-new file");
    const written = JSON.parse(await readFile(target, "utf8"));
    assert.ok(written.hooks.UserPromptSubmit, "hooks written");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyHookConfig backs up, writes atomically, preserves other keys, and is idempotent on re-run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rpgdev-apply-"));
  try {
    const target = join(dir, "settings.json");
    await writeFile(target, JSON.stringify({ permissions: { allow: ["Bash"] }, hooks: {} }, null, 2));
    const r1 = await applyHookConfig(target, CONFIG);
    assert.equal(r1.applied, true);
    await access(`${target}.rpgdev-bak`, constants.F_OK); // backup exists
    const after1 = JSON.parse(await readFile(target, "utf8"));
    assert.deepEqual(after1.permissions, { allow: ["Bash"] }, "other keys preserved");
    assert.ok(after1.hooks.Stop, "hooks applied");

    const r2 = await applyHookConfig(target, CONFIG);
    assert.equal(r2.applied, true);
    const after2 = JSON.parse(await readFile(target, "utf8"));
    assert.equal(after2.hooks.PreToolUse.length, 1, "re-run does not duplicate");
    // backup must still be the pristine original (no hooks), not the modified one
    const bak = JSON.parse(await readFile(`${target}.rpgdev-bak`, "utf8"));
    assert.deepEqual(bak.hooks, {}, "backup keeps the pristine original");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyHookConfig refuses (does not write) when the existing file is invalid JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rpgdev-apply-"));
  try {
    const target = join(dir, "settings.json");
    await writeFile(target, "{ not valid json ");
    const result = await applyHookConfig(target, CONFIG);
    assert.equal(result.applied, false);
    assert.match(result.reason, /not valid JSON/);
    const untouched = await readFile(target, "utf8");
    assert.equal(untouched, "{ not valid json ", "file left untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
