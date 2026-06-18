#!/usr/bin/env node
// `rpgdev setup-shortcut` — Windows のスタートメニューに RPGDev を登録する（水の精霊 Aqua の顔アイコン付き）。
// 目的：手動の起動口を用意し、ハブ稼働の常駐トレイ（desktop.mjs が窓と一緒に起動）への導線にする。
// 管理者権限は不要（ユーザーの Start Menu に .lnk を置くだけ）。WSL2 からも interop で作れる。
//
// 手順：①desktop.mjs --build-only でトレイ exe と顔アイコン(.ico)を用意（無ければ作る）→
//        ②WScript.Shell でショートカットを作成（Target=rpgdev 起動、Icon=生成した .ico）。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectPlatform } from "./desktop-platform.mjs";
import { winHubDirFromLocalAppData } from "./hub-net.mjs";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DESKTOP_MJS = join(PACKAGE_ROOT, "scripts", "desktop.mjs");

main().catch((error) => {
  console.error(`[rpgdev shortcut] ${error.stack || error}`);
  process.exitCode = 1;
});

async function main() {
  const platform = detectPlatform();
  if (platform !== "win32" && platform !== "wsl") {
    console.log(`[rpgdev shortcut] Start Menu shortcut is Windows-only — not needed on ${platform}.`);
    return;
  }

  // ① トレイ exe と顔アイコン(.ico)を用意（--build-only がトレイ＋ico も作る）。
  console.log("[rpgdev shortcut] Preparing the tray icon (.ico) — building if needed …");
  await runNode([DESKTOP_MJS, "--build-only"]);

  // Windows 側のハブ dir（…\rpgdev\hub）と、そこに生成された .ico。
  const localAppData = (await ps("$env:LOCALAPPDATA")).out;
  if (!localAppData) {
    throw new Error("Could not read %LOCALAPPDATA% (needed to locate the generated icon).");
  }
  const hubWin = winHubDirFromLocalAppData(localAppData);
  const icoWin = `${hubWin}\\rpgdev.ico`;
  if ((await ps(`Test-Path '${psq(icoWin)}'`)).out !== "True") {
    throw new Error(`Icon was not generated: ${icoWin}. The desktop build may have failed — re-run after launching rpgdev once.`);
  }

  // ② 起動コマンド（クリックで窓＋ハブ＋トレイが開く）。
  let targetPath;
  let argline;
  let workdir;
  let minimized = false;
  if (platform === "win32") {
    targetPath = process.execPath; // Windows node.exe
    argline = `"${join(PACKAGE_ROOT, "bin", "rpgdev")}"`;
    workdir = PACKAGE_ROOT;
  } else {
    // WSL：Windows の wsl.exe から WSL 側の rpgdev（runWsl）を絶対パスで起動（PATH 非依存）。
    targetPath = "wsl.exe";
    argline = `-e ${process.execPath} ${join(PACKAGE_ROOT, "bin", "rpgdev")}`;
    workdir = hubWin;
    minimized = true; // wsl.exe のコンソールが一瞬出るので最小化
  }

  const programs = (await ps('[Environment]::GetFolderPath("Programs")')).out;
  if (!programs) {
    throw new Error("Could not resolve the Start Menu Programs folder.");
  }
  const lnkPath = `${programs}\\RPGDev.lnk`;

  const lines = [
    "$ws = New-Object -ComObject WScript.Shell",
    `$s = $ws.CreateShortcut('${psq(lnkPath)}')`,
    `$s.TargetPath = '${psq(targetPath)}'`,
    `$s.Arguments = '${psq(argline)}'`,
    `$s.WorkingDirectory = '${psq(workdir)}'`,
    `$s.IconLocation = '${psq(icoWin)}'`,
    "$s.Description = 'RPGDev — start the hub and window'"
  ];
  if (minimized) lines.push("$s.WindowStyle = 7");
  lines.push("$s.Save()");

  const made = await ps(lines.join("; "));
  if (!made.ok) {
    console.error(`[rpgdev shortcut] Failed to create the Start Menu shortcut.\n${made.err}`);
    process.exitCode = 1;
    return;
  }
  if ((await ps(`Test-Path '${psq(lnkPath)}'`)).out === "True") {
    console.log("[rpgdev shortcut] Done — Start Menu entry 'RPGDev' created (Aqua-face icon).");
    console.log(`  ${lnkPath}`);
  } else {
    console.error(`[rpgdev shortcut] Shortcut not found after creation: ${lnkPath}`);
    process.exitCode = 1;
  }
}

// PowerShell の単一引用符文字列用エスケープ（' を '' に）。
function psq(value) {
  return String(value).replace(/'/g, "''");
}

// node を子プロセスで実行して終了を待つ（ビルド出力はそのまま見せる）。
function runNode(argv) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, argv, { stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("close", (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`desktop build exited ${code}`))));
  });
}

// powershell.exe を1回叩いて stdout を返す（win32 は直接、wsl は interop）。
function ps(command) {
  return new Promise((resolvePs) => {
    let out = "";
    let err = "";
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (err += chunk.toString("utf8")));
    child.on("error", (error) => resolvePs({ ok: false, out: "", err: String(error.message || error) }));
    child.on("close", (code) =>
      resolvePs({ ok: code === 0, out: out.replace(/\r/g, "").trim(), err: err.replace(/\r/g, "").trim() })
    );
  });
}
