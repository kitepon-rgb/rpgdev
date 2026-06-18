#!/usr/bin/env node
import { access, mkdir, rmdir, stat, appendFile, readFile, writeFile, copyFile, cp } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPlatform } from "./desktop-platform.mjs";
import { hubBindHost, hubReachHost, HUB_WINDOW_HOST, winHubDirFromLocalAppData, HUB_PORT, HUB_INSTANCE_KEY } from "./hub-net.mjs";

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROJECT_DIR = resolve(process.env.RPGDEV_PROJECT_DIR || process.cwd());
const PLATFORM = detectPlatform();
const PROJECT_DATA_DIR = join(PROJECT_DIR, ".rpgdev"); // エラーログはプロジェクト単位（どの起動が失敗したか追える）。
const LOG_PATH = join(PROJECT_DATA_DIR, "desktop-errors.log");
const PORT = HUB_PORT;
const BIND_HOST = hubBindHost(); // サーバ待受（win32/wsl=0.0.0.0、他=127.0.0.1）。RPGDEV_HOST env として渡す。
const REACH_HOST = hubReachHost(); // このプロセス→ハブの到達先（health 確認）。win32=127.0.0.1 / wsl=ゲートウェイ。
const BASE_URL = `http://${HUB_WINDOW_HOST}:${PORT}`; // 窓の接続先＝常に同ホスト localhost（WebView2 は localhost なら確実）。
const HEALTH_BASE = `http://${REACH_HOST}:${PORT}`; // 起動確認の宛先（このプロセス→ハブ）。
const args = new Set(process.argv.slice(2));

// 窓は環境/プロジェクトをまたいで常に1つ＝固定の単一インスタンスキー（Windows C# named Mutex 名）。
const INSTANCE_KEY = HUB_INSTANCE_KEY;

// 窓ビルド/状態/ロックの置き場：win32 は単一グローバルハブ dir（%LOCALAPPDATA%\rpgdev\hub）、
// それ以外は従来の .rpgdev。win32 はサーバ state もこのグローバル dir 配下に置く（1つの共有冒険）。
const HUB_DATA_DIR =
  PLATFORM === "win32"
    ? winHubDirFromLocalAppData(process.env.LOCALAPPDATA || PROJECT_DATA_DIR)
    : PROJECT_DATA_DIR;
const SERVER_PROJECT_DIR = PLATFORM === "win32" ? HUB_DATA_DIR : PROJECT_DIR;
const LOCK_DIR = join(HUB_DATA_DIR, "desktop.lock"); // 窓 open を直列化するロック（二重窓防止）。mkdir のアトミック性を利用。

// --- macOS（Swift+WKWebView）窓のパス ---
const SWIFT_SOURCE = join(PACKAGE_ROOT, "desktop", "RPGDevWindow.swift");
const APP_BUNDLE = join(HUB_DATA_DIR, "RPGDev.app");
const APP_CONTENTS = join(APP_BUNDLE, "Contents");
const APP_MACOS = join(APP_CONTENTS, "MacOS");
const WINDOW_BINARY = join(APP_MACOS, "RPGDev");
const INFO_PLIST = join(APP_CONTENTS, "Info.plist");

// --- Windows / WSL2（C# WinForms+WebView2）窓のパス ---
const CS_SOURCE = join(PACKAGE_ROOT, "desktop", "RPGDevWindow.cs");
const WEBVIEW2_DIR = join(PACKAGE_ROOT, "desktop", "webview2");
const CORE_DLL = join(WEBVIEW2_DIR, "Microsoft.Web.WebView2.Core.dll");
const LOADER_DLL = join(WEBVIEW2_DIR, "WebView2Loader.dll");
const WIN_BUILD_DIR = join(HUB_DATA_DIR, "RPGDevWin");
const WIN_EXE = join(WIN_BUILD_DIR, "RPGDev.exe");
const WIN_WEBVIEW2_DATA = join(HUB_DATA_DIR, "webview2-data");
const WIN_STATE_JSON = join(HUB_DATA_DIR, "desktop-window-win.json");

// --- タスクトレイ常駐（ハブ稼働の可視化。WebView2 不要の C# WinForms NotifyIcon） ---
const TRAY_SOURCE = join(PACKAGE_ROOT, "desktop", "RPGDevTray.cs");
const WIN_TRAY_EXE = join(WIN_BUILD_DIR, "RPGDevTray.exe");
const TRAY_SPRITE_NAME = "ally-water-facing-slit.png"; // トレイの顔アイコン元（Aqua）
const TRAY_SPRITE_SRC = join(PACKAGE_ROOT, "public", "assets", "sprites", TRAY_SPRITE_NAME);
const WIN_TRAY_SPRITE = join(WIN_BUILD_DIR, TRAY_SPRITE_NAME);
const TRAY_ICO_NAME = "rpgdev.ico"; // スタートメニューのショートカット用アイコン（顔を .ico 化）
const WIN_TRAY_ICO = join(HUB_DATA_DIR, TRAY_ICO_NAME); // ハブ dir 直下（win32/WSL でアイコン位置を統一）

await mkdir(PROJECT_DATA_DIR, { recursive: true }); // ログ用（プロジェクト単位）
await mkdir(HUB_DATA_DIR, { recursive: true }); // 窓ビルド/状態/ロック用（win32 はグローバルハブ dir）

try {
  if (args.has("--ensure-hub")) {
    // 窓を出さずにハブ（サーバ）だけ確実に起こす。rpg-hook が hub 起動を desktop.mjs に委譲するための入口。
    await ensureHub();
  } else if (PLATFORM === "darwin") {
    await runDarwin();
  } else if (PLATFORM === "win32") {
    await runWin32();
  } else if (PLATFORM === "wsl") {
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
    await buildWinTrayIfNeeded();
    return;
  }
  await ensureServer();
  const url = `${BASE_URL}/overlay.html`;
  // C# 側の named Mutex が多重窓を防ぎ既存窓を前面化する。desktop.mjs の mkdir ロックはビルド/起動の直列化用。
  const locked = await acquireWindowLock();
  try {
    if (locked) {
      await buildWinWindowIfNeeded();
      await buildWinTrayIfNeeded();
    } else if (!(await waitForFile(WIN_EXE, 8000))) {
      // 別インスタンスがまだビルド中でなく exe も無い＝自分でビルドする。
      await buildWinWindowIfNeeded();
      await buildWinTrayIfNeeded();
    }
    launchWinWindow(url, WIN_WEBVIEW2_DATA, WIN_STATE_JSON);
    launchWinTray(url, WIN_WEBVIEW2_DATA, WIN_STATE_JSON); // ハブ稼働を示す常駐（単一インスタンスはトレイ側ロック）
    await delay(400);
  } finally {
    if (locked) await releaseWindowLock();
  }
}

async function buildWinTrayIfNeeded() {
  await mkdir(WIN_BUILD_DIR, { recursive: true });
  await copyFile(TRAY_SPRITE_SRC, WIN_TRAY_SPRITE); // 顔アイコン元を exe の隣に置く（実行時に読む）
  const [sourceStat, exeStat] = await Promise.all([stat(TRAY_SOURCE), statOrNull(WIN_TRAY_EXE)]);
  if (!exeStat || exeStat.mtimeMs < sourceStat.mtimeMs) {
    const csc = await findCsc([process.env.WINDIR, process.env.SystemRoot, "C:\\Windows"]);
    await run(csc, [
      "/nologo",
      "/target:winexe",
      "/platform:x64",
      "/reference:System.Windows.Forms.dll",
      "/reference:System.Drawing.dll",
      `/out:${WIN_TRAY_EXE}`,
      TRAY_SOURCE
    ]);
  }
  // スタートメニューのショートカット用 .ico（顔を 256px 化）。無ければ生成する。
  if (!(await statOrNull(WIN_TRAY_ICO))) {
    await run(WIN_TRAY_EXE, ["--make-ico", WIN_TRAY_SPRITE, WIN_TRAY_ICO]).catch((error) => {
      console.error(`[rpgdev-desktop] tray icon (.ico) generation failed: ${error.message || error}`);
    });
  }
}

// トレイ常駐を起動。args=[hubUrl, 顔PNG, instanceKey, 窓exe, 窓url, 窓data, 窓state]。
function launchWinTray(url, dataDir, stateJson) {
  const child = spawn(WIN_TRAY_EXE, [BASE_URL, WIN_TRAY_SPRITE, INSTANCE_KEY, WIN_EXE, url, dataDir, stateJson], {
    cwd: WIN_BUILD_DIR,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function buildWinWindowIfNeeded() {
  await ensureWebView2Dlls();
  await mkdir(WIN_BUILD_DIR, { recursive: true });
  // ネイティブローダ／マネージドラッパは exe と同じディレクトリに置く（実行時に解決させる）。
  const coreBeside = join(WIN_BUILD_DIR, "Microsoft.Web.WebView2.Core.dll");
  await copyDll(CORE_DLL, coreBeside);
  await copyDll(LOADER_DLL, join(WIN_BUILD_DIR, "WebView2Loader.dll"));

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
    const cacheWin = await buildWslWindow();
    await buildWslTray(cacheWin);
    return;
  }
  await ensureWindowsHubFromWsl(); // ハブ（サーバ）は Windows ホスト側で interop 起動し、WSL アダプタ IP に待ち受ける
  const locked = await acquireWindowLock();
  try {
    // 自分が担当ならビルド、そうでなければ別インスタンスのビルド完了を待つ。
    const cacheWin = locked ? await buildWslWindow() : await waitWslCache();
    if (locked) await buildWslTray(cacheWin);
    // 窓も Windows ホストで起動し、ハブ（<gateway>:PORT）へ直接つなぐ。
    await launchWslWindow(cacheWin);
    await launchWslTray(cacheWin); // ハブ稼働を示す常駐（単一インスタンスはトレイ側ロック）
    await delay(500);
  } finally {
    if (locked) await releaseWindowLock();
  }
}

// WSL：トレイ cs と顔アイコン元をキャッシュへコピーし、interop csc でビルド（WebView2 参照は不要）。
async function buildWslTray(cacheWin) {
  const cacheLinux = await toLinuxPath(cacheWin);
  await copyFile(TRAY_SOURCE, join(cacheLinux, "RPGDevTray.cs"));
  await copyFile(TRAY_SPRITE_SRC, join(cacheLinux, TRAY_SPRITE_NAME)); // 顔アイコン元を exe の隣へ
  const exeLinux = join(cacheLinux, "RPGDevTray.exe");
  const [sourceStat, exeStat] = await Promise.all([stat(TRAY_SOURCE), statOrNull(exeLinux)]);
  if (!exeStat || exeStat.mtimeMs < sourceStat.mtimeMs) {
    const winDirLinux = await toLinuxPath(await cmdEcho("SystemRoot"));
    const csc = await findCsc([winDirLinux || "/mnt/c/Windows"]);
    await run(
      csc,
      [
        "/nologo",
        "/target:winexe",
        "/platform:x64",
        "/reference:System.Windows.Forms.dll",
        "/reference:System.Drawing.dll",
        `/out:${cacheWin}\\RPGDevTray.exe`,
        `${cacheWin}\\RPGDevTray.cs`
      ],
      { cwd: "/mnt/c" }
    );
  }
  // スタートメニューのショートカット用 .ico（顔を 256px 化）。無ければ生成する。
  if (!(await statOrNull(join(cacheLinux, TRAY_ICO_NAME)))) {
    await run(exeLinux, ["--make-ico", `${cacheWin}\\${TRAY_SPRITE_NAME}`, `${cacheWin}\\${TRAY_ICO_NAME}`], {
      cwd: "/mnt/c"
    }).catch((error) => {
      console.error(`[rpgdev-desktop] tray icon (.ico) generation failed: ${error.message || error}`);
    });
  }
}

async function launchWslTray(cacheWin) {
  const exeLinux = await toLinuxPath(`${cacheWin}\\RPGDevTray.exe`);
  const spriteWin = `${cacheWin}\\${TRAY_SPRITE_NAME}`;
  const winExe = `${cacheWin}\\RPGDev.exe`;
  const url = `${BASE_URL}/overlay.html`;
  const dataWin = `${cacheWin}\\webview2-data`;
  const stateWin = `${cacheWin}\\window.json`;
  const child = spawn(exeLinux, [BASE_URL, spriteWin, INSTANCE_KEY, winExe, url, dataWin, stateWin], {
    cwd: "/mnt/c",
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

// ロックを取れなかった（別インスタンスがビルド中）場合のキャッシュ待ち。
async function waitWslCache() {
  const cacheWin = await wslCacheWinDir();
  const exeLinux = await toLinuxPath(`${cacheWin}\\RPGDev.exe`);
  if (await waitForFile(exeLinux, 8000)) return cacheWin;
  // 出来ていなければ自分でビルド。
  return await buildWslWindow();
}

// Windows 側ビルドキャッシュ（%LOCALAPPDATA%\rpgdev\hub）を用意し、ソース/DLL をコピーして csc でコンパイル。
// 戻り値は Windows パス文字列。
async function buildWslWindow() {
  await ensureWebView2Dlls();
  const cacheWin = await wslCacheWinDir();
  const cacheLinux = await toLinuxPath(cacheWin);
  await mkdir(cacheLinux, { recursive: true });

  const csLinux = join(cacheLinux, "RPGDevWindow.cs");
  const coreLinux = join(cacheLinux, "Microsoft.Web.WebView2.Core.dll");
  await copyFile(CS_SOURCE, csLinux);
  await copyDll(CORE_DLL, coreLinux);
  await copyDll(LOADER_DLL, join(cacheLinux, "WebView2Loader.dll"));

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
  const url = `${BASE_URL}/overlay.html`; // 窓は Windows ホスト上＝同ホストのハブへ localhost で繋ぐ（WebView2 は localhost なら確実）
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
  return winHubDirFromLocalAppData(localAppData); // 単一グローバルハブ dir（…\rpgdev\hub）
}

// WSL2 から Windows ホスト上のハブ（node サーバ）を interop で起こす。窓ではなくサーバの存在だけ保証する。
// 既に <gateway>:PORT で生きていれば何もしない。状態は Windows ローカルの hub dir（…\rpgdev\hub）に置く。
async function ensureWindowsHubFromWsl() {
  if (await health()) return;

  const hubWin = await wslCacheWinDir(); // %LOCALAPPDATA%\rpgdev\hub（Windows パス）
  const hubLinux = await toLinuxPath(hubWin);
  if (!hubLinux) {
    throw new Error("WSL2: could not translate the hub dir to a Linux path (wslpath failed).");
  }
  // 不具合修正：WSL 共有(\\wsl.localhost)から server を直接実行すると、ホスト上の WebView2 が
  // リアルタイム配信(SSE)を受け取れない。server/ と public/ を Windows ローカル(hub dir)へコピーしてから
  // そのコピーを実行する（窓 exe をコピーしてビルドするのと同型＝Windows ネイティブと同じローカル実行）。
  await copyServerToHub(hubLinux);
  const serverScriptWin = `${hubWin}\\server\\rpgdev-server.mjs`;
  const node = await findWindowsNode();
  // WSL→Windows の env は WSLENV に列挙した変数だけが越える（SystemRoot 等は interop が自動注入するが
  // 独自変数は明示が要る）。RPGDEV_PROJECT_DIR は既に Windows パスなので path 変換しない（フラグ無し）。
  const wslenv = [process.env.WSLENV, "RPGDEV_PORT", "RPGDEV_HOST", "RPGDEV_PROJECT_DIR"]
    .filter(Boolean)
    .join(":");
  const child = spawn(node, [serverScriptWin], {
    cwd: "/mnt/c",
    detached: true,
    stdio: "ignore",
    // サーバは 0.0.0.0(BIND_HOST) で待ち受ける＝localhost(窓) も WSL アダプタ IP(WSL2 フック) も受ける。
    env: { ...process.env, RPGDEV_PORT: String(PORT), RPGDEV_HOST: BIND_HOST, RPGDEV_PROJECT_DIR: hubWin, WSLENV: wslenv }
  });
  child.unref();

  const deadline = Date.now() + 8000; // interop 起動＋初回コピー後の読込はやや遅い
  while (Date.now() < deadline) {
    if (await health()) return;
    await delay(150);
  }
  throw new Error(
    `RPG Dev hub did not start on the Windows host (${HEALTH_BASE}). ` +
      "Check the WSL→host firewall (inbound TCP on the hub port) and that node is installed on the host."
  );
}

// server/ と public/ を Windows ローカルの hub dir へコピーする（WSL 共有実行の回避）。
// 再配信判定は **パッケージ版（package.json の version）** で行う＝公開版を入れ替える（版が変わる）たびに
// server も public も確実に再配信する。旧実装は server 1ファイルの mtime でゲートしており、フロントだけの変更
// （public/overlay.js 等）が再配信されず、かつ npm 導入物の正規化 mtime で「配信済みの方が新しい」と誤判定して
// 更新を取りこぼしていた（＝公開した修正が窓に届かない致命バグ）。版マーカで根治。
async function copyServerToHub(hubLinux) {
  const srcVersion = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  const marker = join(hubLinux, ".rpgdev-deployed-version");
  const deployed = await readFile(marker, "utf8").then((text) => text.trim()).catch(() => null);
  if (deployed === srcVersion) return; // 同版＝既に配信済み（重い public コピーをスキップ）
  await cp(join(PACKAGE_ROOT, "server"), join(hubLinux, "server"), { recursive: true });
  await cp(join(PACKAGE_ROOT, "public"), join(hubLinux, "public"), { recursive: true });
  await writeFile(marker, srcVersion);
}

// Windows ホストの node.exe を interop で解決する（spawn 用に /mnt/c の Linux パスで返す）。
async function findWindowsNode() {
  const out = await run("cmd.exe", ["/d", "/c", "where node"], { capture: true, allowFailure: true, cwd: "/mnt/c" });
  const winLine = out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /node\.exe$/i.test(line));
  if (winLine) {
    const linux = await toLinuxPath(winLine);
    if (linux && (await statOrNull(linux))) return linux;
  }
  const fallback = await toLinuxPath("C:\\Program Files\\nodejs\\node.exe");
  if (fallback && (await statOrNull(fallback))) return fallback;
  throw new Error(
    "WSL2: Windows host `node.exe` not found (tried `where node` and C:\\Program Files\\nodejs). " +
      "Install Node on the Windows host so the hub can run there."
  );
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

// 窓を出さずにハブ（サーバ）だけ確実に起こす。rpg-hook が --ensure-hub で委譲する入口。
async function ensureHub() {
  if (PLATFORM === "wsl") {
    await ensureWindowsHubFromWsl();
  } else {
    await ensureServer();
  }
}

async function ensureServer() {
  if (await health()) return;

  const child = spawn(process.execPath, [join(PACKAGE_ROOT, "server", "rpgdev-server.mjs")], {
    cwd: PACKAGE_ROOT,
    detached: true,
    stdio: "ignore",
    // win32 はサーバ state を単一グローバルハブ dir に置く（1 つの共有冒険）。darwin/linux は従来通りプロジェクト単位。
    env: { ...process.env, RPGDEV_PORT: String(PORT), RPGDEV_HOST: BIND_HOST, RPGDEV_PROJECT_DIR: SERVER_PROJECT_DIR }
  });
  child.unref();

  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    if (await health()) return;
    await delay(120);
  }
  throw new Error(`RPG Dev server did not start on ${HEALTH_BASE}`);
}

async function health() {
  try {
    const response = await fetch(`${HEALTH_BASE}/health`);
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

// 同梱 DLL（WebView2）を配置する。実行中の窓が掴んでいて上書きできない（EACCES/EBUSY/EPERM）場合、
// 既に同じ DLL が置いてあるなら上書き失敗は無害なのでスキップする（DLL は版内で不変＝既知の OS 条件の正当な処理）。
// 本当に未配置で書けない時は黙らず投げる（静かなフォールバックにしない）。
async function copyDll(src, dest) {
  try {
    await copyFile(src, dest);
  } catch (error) {
    const inUse = error.code === "EACCES" || error.code === "EBUSY" || error.code === "EPERM";
    if (inUse && (await statOrNull(dest))) return; // 既に配置済み＝使用中で上書きできなくても問題ない
    throw error;
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
