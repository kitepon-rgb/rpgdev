#!/usr/bin/env node
import { access, mkdir, rmdir, stat, appendFile, writeFile, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { detectPlatform } from "./desktop-platform.mjs";

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROJECT_DIR = resolve(process.env.RPGDEV_PROJECT_DIR || process.cwd());
const DATA_DIR = join(PROJECT_DIR, ".rpgdev");
const LOG_PATH = join(DATA_DIR, "desktop-errors.log");
const LOCK_DIR = join(DATA_DIR, "desktop.lock"); // 窓 open を直列化するロック（二重窓防止）。mkdir のアトミック性を利用。
const PORT = Number(process.env.RPGDEV_PORT || 37373);
const HOST = process.env.RPGDEV_HOST || "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const args = new Set(process.argv.slice(2));

// プロジェクト×ポートで一意な単一インスタンスキー（Windows ホスト側 C# の named Mutex 名に使う）。
const PROJECT_HASH = createHash("sha1").update(`${PROJECT_DIR}:${PORT}`).digest("hex").slice(0, 8);
const INSTANCE_KEY = `rpgdev-${PORT}-${PROJECT_HASH}`;

// --- macOS（Swift+WKWebView）窓のパス ---
const SWIFT_SOURCE = join(PACKAGE_ROOT, "desktop", "RPGDevWindow.swift");
const APP_BUNDLE = join(DATA_DIR, "RPGDev.app");
const APP_CONTENTS = join(APP_BUNDLE, "Contents");
const APP_MACOS = join(APP_CONTENTS, "MacOS");
const WINDOW_BINARY = join(APP_MACOS, "RPGDev");
const INFO_PLIST = join(APP_CONTENTS, "Info.plist");

// --- Windows / WSL2（C# WinForms+WebView2）窓のパス ---
const CS_SOURCE = join(PACKAGE_ROOT, "desktop", "RPGDevWindow.cs");
const WEBVIEW2_DIR = join(PACKAGE_ROOT, "desktop", "webview2");
const CORE_DLL = join(WEBVIEW2_DIR, "Microsoft.Web.WebView2.Core.dll");
const LOADER_DLL = join(WEBVIEW2_DIR, "WebView2Loader.dll");
const WIN_BUILD_DIR = join(DATA_DIR, "RPGDevWin");
const WIN_EXE = join(WIN_BUILD_DIR, "RPGDev.exe");
const WIN_WEBVIEW2_DATA = join(DATA_DIR, "webview2-data");
const WIN_STATE_JSON = join(DATA_DIR, "desktop-window-win.json");

await mkdir(DATA_DIR, { recursive: true });

try {
  const platform = detectPlatform();
  if (platform === "darwin") {
    await runDarwin();
  } else if (platform === "win32") {
    await runWin32();
  } else if (platform === "wsl") {
    await runWsl();
  } else {
    throw new Error(
      "Desktop window is not supported on bare Linux yet. Use `npm run web` (browser view), " +
        "or run inside WSL2 with a Windows host."
    );
  }
} catch (error) {
  await appendFile(LOG_PATH, `${new Date().toISOString()} ${error.stack || error}\n`);
  if (!args.has("--from-hook")) {
    console.error(`[rpgdev-desktop] ${error.message || error}`);
  }
  process.exitCode = 1;
}

// =========================== macOS ===========================

async function runDarwin() {
  await buildSwiftWindowIfNeeded();
  if (args.has("--build-only")) return;

  await ensureServer();
  // 既存窓があれば open せずフォーカスして終了（多重窓防止の最速経路）。
  if (await focusExistingMacWindow()) return;

  // 窓 open を直列化：ビルド/起動が競合しても窓は1つだけにする。
  const locked = await acquireWindowLock(pgrepMacWindow);
  try {
    if (await focusExistingMacWindow()) return;
    if (!locked && (await waitForMacWindow(5000))) return;

    const child = spawn("open", ["-n", APP_BUNDLE, "--args", `${BASE_URL}/overlay.html`], {
      cwd: PACKAGE_ROOT,
      detached: true,
      stdio: args.has("--from-hook") ? "ignore" : "inherit"
    });
    child.unref();
    await waitForMacWindow(6000); // 自分の窓が立つまで待ってからロック解放（後続インスタンスの取りこぼし防止）
  } finally {
    if (locked) await releaseWindowLock();
  }
}

async function buildSwiftWindowIfNeeded() {
  await mkdir(APP_MACOS, { recursive: true });
  await writeFile(INFO_PLIST, infoPlist());

  const [sourceStat, binaryStat] = await Promise.all([stat(SWIFT_SOURCE), statOrNull(WINDOW_BINARY)]);
  if (binaryStat && binaryStat.mtimeMs >= sourceStat.mtimeMs) return;

  await run("swiftc", [SWIFT_SOURCE, "-framework", "Cocoa", "-framework", "WebKit", "-o", WINDOW_BINARY]);
}

async function focusExistingMacWindow() {
  const pid = await pgrepMacWindow();
  if (!pid) return false;

  const script = `tell application "System Events" to set frontmost of first process whose unix id is ${pid} to true`;
  await run("osascript", ["-e", script], { allowFailure: true });
  return true;
}

async function pgrepMacWindow() {
  const result = await run("pgrep", ["-f", `${WINDOW_BINARY} ${BASE_URL}/overlay.html`], {
    capture: true,
    allowFailure: true
  });
  const pid = result.trim().split(/\s+/).find(Boolean);
  return pid || "";
}

async function waitForMacWindow(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pgrepMacWindow()) return true;
    await delay(150);
  }
  return false;
}

// =========================== Windows（ネイティブ） ===========================

async function runWin32() {
  if (args.has("--build-only")) {
    await buildWinWindowIfNeeded();
    return;
  }
  await ensureServer();
  const url = `${BASE_URL}/overlay.html`;
  // C# 側の named Mutex が多重窓を防ぎ既存窓を前面化する。desktop.mjs の mkdir ロックはビルド/起動の直列化用。
  const locked = await acquireWindowLock();
  try {
    if (locked) {
      await buildWinWindowIfNeeded();
    } else if (!(await waitForFile(WIN_EXE, 8000))) {
      // 別インスタンスがまだビルド中でなく exe も無い＝自分でビルドする。
      await buildWinWindowIfNeeded();
    }
    launchWinWindow(url, WIN_WEBVIEW2_DATA, WIN_STATE_JSON);
    await delay(400);
  } finally {
    if (locked) await releaseWindowLock();
  }
}

async function buildWinWindowIfNeeded() {
  await ensureWebView2Dlls();
  await mkdir(WIN_BUILD_DIR, { recursive: true });
  // ネイティブローダ／マネージドラッパは exe と同じディレクトリに置く（実行時に解決させる）。
  const coreBeside = join(WIN_BUILD_DIR, "Microsoft.Web.WebView2.Core.dll");
  await copyFile(CORE_DLL, coreBeside);
  await copyFile(LOADER_DLL, join(WIN_BUILD_DIR, "WebView2Loader.dll"));

  const [sourceStat, exeStat] = await Promise.all([stat(CS_SOURCE), statOrNull(WIN_EXE)]);
  if (exeStat && exeStat.mtimeMs >= sourceStat.mtimeMs) return;

  const csc = await findCsc([process.env.WINDIR, process.env.SystemRoot, "C:\\Windows"]);
  await run(csc, [
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    `/reference:${coreBeside}`,
    `/out:${WIN_EXE}`,
    CS_SOURCE
  ]);
}

function launchWinWindow(url, dataDir, stateJson) {
  const child = spawn(WIN_EXE, [url, dataDir, stateJson, INSTANCE_KEY], {
    cwd: WIN_BUILD_DIR,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

// =========================== WSL2（完全自動：interop で Windows 側にコンパイル＆起動） ===========================

async function runWsl() {
  if (args.has("--build-only")) {
    await buildWslWindow();
    return;
  }
  await ensureServer(); // サーバは WSL2（Linux）側で動く
  const locked = await acquireWindowLock();
  try {
    // 自分が担当ならビルド、そうでなければ別インスタンスのビルド完了を待つ。
    const cacheWin = locked ? await buildWslWindow() : await waitWslCache();
    // 窓は Windows ホストで起動。localhostForwarding で Windows の localhost が WSL2 のサーバへ届く。
    await launchWslWindow(cacheWin);
    await delay(500);
  } finally {
    if (locked) await releaseWindowLock();
  }
}

// ロックを取れなかった（別インスタンスがビルド中）場合のキャッシュ待ち。
async function waitWslCache() {
  const cacheWin = await wslCacheWinDir();
  const exeLinux = await toLinuxPath(`${cacheWin}\\RPGDev.exe`);
  if (await waitForFile(exeLinux, 8000)) return cacheWin;
  // 出来ていなければ自分でビルド。
  return await buildWslWindow();
}

// Windows 側ビルドキャッシュ（%LOCALAPPDATA%\rpgdev\<hash>）を用意し、ソース/DLL をコピーして csc でコンパイル。
// 戻り値は Windows パス文字列。
async function buildWslWindow() {
  await ensureWebView2Dlls();
  const cacheWin = await wslCacheWinDir();
  const cacheLinux = await toLinuxPath(cacheWin);
  await mkdir(cacheLinux, { recursive: true });

  const csLinux = join(cacheLinux, "RPGDevWindow.cs");
  const coreLinux = join(cacheLinux, "Microsoft.Web.WebView2.Core.dll");
  await copyFile(CS_SOURCE, csLinux);
  await copyFile(CORE_DLL, coreLinux);
  await copyFile(LOADER_DLL, join(cacheLinux, "WebView2Loader.dll"));

  const exeLinux = join(cacheLinux, "RPGDev.exe");
  const [sourceStat, exeStat] = await Promise.all([stat(CS_SOURCE), statOrNull(exeLinux)]);
  if (exeStat && exeStat.mtimeMs >= sourceStat.mtimeMs) return cacheWin;

  // /mnt/c 配下の Windows csc.exe を interop で実行（Windows パスを引数に渡す）。
  const winDirLinux = await toLinuxPath(await cmdEcho("SystemRoot"));
  const csc = await findCsc([winDirLinux || "/mnt/c/Windows"]);
  const coreWin = `${cacheWin}\\Microsoft.Web.WebView2.Core.dll`;
  const csWin = `${cacheWin}\\RPGDevWindow.cs`;
  const exeWin = `${cacheWin}\\RPGDev.exe`;
  await run(
    csc,
    [
      "/nologo",
      "/target:winexe",
      "/platform:x64",
      "/reference:System.Windows.Forms.dll",
      "/reference:System.Drawing.dll",
      `/reference:${coreWin}`,
      `/out:${exeWin}`,
      csWin
    ],
    { cwd: "/mnt/c" } // cmd/csc を UNC cwd で動かさない（警告/失敗を避ける）
  );
  return cacheWin;
}

async function launchWslWindow(cacheWin) {
  const exeLinux = await toLinuxPath(`${cacheWin}\\RPGDev.exe`);
  const dataWin = `${cacheWin}\\webview2-data`;
  const stateWin = `${cacheWin}\\window.json`;
  const url = `http://localhost:${PORT}/overlay.html`; // Windows ホスト→WSL2 は localhost 転送
  const child = spawn(exeLinux, [url, dataWin, stateWin, INSTANCE_KEY], {
    cwd: "/mnt/c",
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function wslCacheWinDir() {
  const localAppData = await cmdEcho("LOCALAPPDATA");
  if (!localAppData) {
    throw new Error(
      "WSL2 interop unavailable: could not read %LOCALAPPDATA% via cmd.exe. " +
        "Ensure WSL interop is enabled and cmd.exe is reachable."
    );
  }
  return `${localAppData}\\rpgdev\\${PROJECT_HASH}`;
}

// cmd.exe で Windows 環境変数を読む（UNC 警告を避けるため cwd=/mnt/c）。
async function cmdEcho(name) {
  const out = await run("cmd.exe", ["/d", "/c", `echo %${name}%`], {
    capture: true,
    allowFailure: true,
    cwd: "/mnt/c"
  });
  const value = out.replace(/\r?\n/g, "").trim();
  return value && value !== `%${name}%` ? value : "";
}

async function toLinuxPath(winPath) {
  if (!winPath) return "";
  const out = await run("wslpath", ["-u", winPath], { capture: true, allowFailure: true, cwd: "/mnt/c" });
  return out.replace(/\r?\n/g, "").trim();
}

// =========================== Windows/WSL 共有 ===========================

// .NET Framework 4.x の csc.exe を探す（Framework64 → Framework）。roots は Windows の %WINDIR%（win32）
// または /mnt/c/Windows（WSL）を渡す。見つからなければ沈黙せず明確に落とす。
async function findCsc(roots) {
  const dirs = roots.filter(Boolean);
  for (const root of dirs) {
    for (const arch of ["Framework64", "Framework"]) {
      const candidate = join(root, "Microsoft.NET", arch, "v4.0.30319", "csc.exe");
      if (await statOrNull(candidate)) return candidate;
    }
  }
  throw new Error(
    "C# compiler (.NET Framework 4.x csc.exe) not found under " +
      dirs.join(", ") +
      ". Install .NET Framework 4.8 (or Visual Studio Build Tools). See docs/windows-wsl.md."
  );
}

async function ensureWebView2Dlls() {
  const missing = [];
  if (!(await statOrNull(CORE_DLL))) missing.push("Microsoft.Web.WebView2.Core.dll");
  if (!(await statOrNull(LOADER_DLL))) missing.push("WebView2Loader.dll");
  if (missing.length === 0) return;
  throw new Error(
    `Missing WebView2 SDK files in desktop/webview2/: ${missing.join(", ")}. ` +
      "Obtain them from the Microsoft.Web.WebView2 NuGet package (Core managed DLL + native x64 WebView2Loader.dll) " +
      "and place them in desktop/webview2/. See docs/windows-wsl.md for the exact steps."
  );
}

// =========================== 共有ヘルパ ===========================

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

async function health() {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// 窓 open を直列化するロック。mkdir はアトミックなので排他に使える。
// 取得できれば true（自分が担当）。30 秒以上前の stale ロックは奪う。windowExists を渡すと、
// 既存窓ありと判定したとき早期に false を返す（macOS の pgrep 用。Windows は C# Mutex が dedup するため未使用）。
async function acquireWindowLock(windowExists) {
  const check = windowExists || (async () => "");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // 最大 ~6 秒
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
      if (await check()) return false;
      await delay(100);
    }
  }
  return false;
}

async function releaseWindowLock() {
  await rmdir(LOCK_DIR).catch(() => {});
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await statOrNull(path)) return true;
    await delay(150);
  }
  return false;
}

async function run(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let output = "";
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || PACKAGE_ROOT,
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
