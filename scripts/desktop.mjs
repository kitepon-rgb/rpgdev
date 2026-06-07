#!/usr/bin/env node
import { access, mkdir, rmdir, stat, appendFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROJECT_DIR = resolve(process.env.RPGDEV_PROJECT_DIR || process.cwd());
const DATA_DIR = join(PROJECT_DIR, ".rpgdev");
const SWIFT_SOURCE = join(PACKAGE_ROOT, "desktop", "RPGDevWindow.swift");
const APP_BUNDLE = join(DATA_DIR, "RPGDev.app");
const APP_CONTENTS = join(APP_BUNDLE, "Contents");
const APP_MACOS = join(APP_CONTENTS, "MacOS");
const WINDOW_BINARY = join(APP_MACOS, "RPGDev");
const INFO_PLIST = join(APP_CONTENTS, "Info.plist");
const LOG_PATH = join(DATA_DIR, "desktop-errors.log");
const LOCK_DIR = join(DATA_DIR, "desktop.lock"); // 窓 open の直列化ロック（二重窓防止）
const PORT = Number(process.env.RPGDEV_PORT || 37373);
const HOST = process.env.RPGDEV_HOST || "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const args = new Set(process.argv.slice(2));

await mkdir(DATA_DIR, { recursive: true });

try {
  if (process.platform !== "darwin") {
    throw new Error("Desktop window mode currently supports macOS only.");
  }

  await buildWindowIfNeeded();
  if (args.has("--build-only")) process.exit(0);

  await ensureServer();
  // 既存窓があれば open せずフォーカスして終了（多重窓防止の最速経路）。
  if (await focusExistingWindow()) process.exit(0);

  // 窓 open を直列化：ビルド/起動が競合しても窓は1つだけにする。
  const locked = await acquireWindowLock();
  try {
    // ロック取得の前後で、他インスタンスが先に窓を立てていないか最終確認。
    if (await focusExistingWindow()) process.exit(0);
    if (!locked && (await waitForWindow(5000))) process.exit(0);

    const child = spawn("open", ["-n", APP_BUNDLE, "--args", `${BASE_URL}/overlay.html`], {
      cwd: PACKAGE_ROOT,
      detached: true,
      stdio: args.has("--from-hook") ? "ignore" : "inherit"
    });
    child.unref();
    await waitForWindow(6000); // 自分の窓が立つまで待ってからロック解放（後続インスタンスの取りこぼし防止）
  } finally {
    if (locked) await releaseWindowLock();
  }
} catch (error) {
  await appendFile(LOG_PATH, `${new Date().toISOString()} ${error.stack || error}\n`);
  if (!args.has("--from-hook")) {
    console.error(`[rpgdev-desktop] ${error.message || error}`);
  }
  process.exitCode = 1;
}

async function buildWindowIfNeeded() {
  await mkdir(APP_MACOS, { recursive: true });
  await writeFile(INFO_PLIST, infoPlist());

  const [sourceStat, binaryStat] = await Promise.all([stat(SWIFT_SOURCE), statOrNull(WINDOW_BINARY)]);
  if (binaryStat && binaryStat.mtimeMs >= sourceStat.mtimeMs) return;

  await run("swiftc", [
    SWIFT_SOURCE,
    "-framework",
    "Cocoa",
    "-framework",
    "WebKit",
    "-o",
    WINDOW_BINARY
  ]);
}

async function ensureServer() {
  if (await health()) return;

  const child = spawn(process.execPath, [join(PACKAGE_ROOT, "server", "rpgdev-server.mjs")], {
    cwd: PACKAGE_ROOT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, RPGDEV_PORT: String(PORT), RPGDEV_HOST: HOST, RPGDEV_PROJECT_DIR: PROJECT_DIR }
  });
  child.unref();

  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    if (await health()) return;
    await delay(120);
  }
  throw new Error(`RPG Dev server did not start on ${BASE_URL}`);
}

async function focusExistingWindow() {
  const pid = await pgrepWindow();
  if (!pid) return false;

  const script = `tell application "System Events" to set frontmost of first process whose unix id is ${pid} to true`;
  await run("osascript", ["-e", script], { allowFailure: true });
  return true;
}

async function pgrepWindow() {
  const result = await run("pgrep", ["-f", `${WINDOW_BINARY} ${BASE_URL}/overlay.html`], {
    capture: true,
    allowFailure: true
  });
  const pid = result.trim().split(/\s+/).find(Boolean);
  return pid || "";
}

// 窓 open を直列化するロック。mkdir はアトミックなので排他に使える。
// 取得できれば true（自分が open 担当）。既存窓がある等で取れなければ false（呼び出し側は待機/フォーカス）。
async function acquireWindowLock() {
  for (let attempt = 0; attempt < 60; attempt += 1) { // 最大 ~6 秒
    try {
      await mkdir(LOCK_DIR);
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = await statOrNull(LOCK_DIR);
      if (info && Date.now() - info.mtimeMs > 30000) {
        await rmdir(LOCK_DIR).catch(() => {}); // 30 秒以上前の stale ロック（前回クラッシュ等）は奪う
        continue;
      }
      if (await pgrepWindow()) return false; // 既に窓があるなら、ロックは諦めて既存を使う
      await delay(100);
    }
  }
  return false;
}

async function releaseWindowLock() {
  await rmdir(LOCK_DIR).catch(() => {});
}

async function waitForWindow(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pgrepWindow()) return true;
    await delay(150);
  }
  return false;
}

async function health() {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function run(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let output = "";
    const child = spawn(command, commandArgs, {
      cwd: PACKAGE_ROOT,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });

    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
    }

    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0 || options.allowFailure) {
        resolveRun(output);
      } else {
        rejectRun(new Error(`${command} exited with ${code}`));
      }
    });
  });
}

async function statOrNull(path) {
  try {
    await access(path, constants.F_OK);
    return await stat(path);
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>RPGDev</string>
  <key>CFBundleIdentifier</key>
  <string>local.rpgdev.overlay</string>
  <key>CFBundleName</key>
  <string>RPGDev</string>
  <key>CFBundleDisplayName</key>
  <string>RPGDev</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
    <key>NSAllowsArbitraryLoadsForMedia</key>
    <true/>
  </dict>
</dict>
</plist>
`;
}
