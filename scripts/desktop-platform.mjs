// デスクトップ窓のプラットフォーム判定（純粋関数・副作用なし＝単体テスト対象）。
// scripts/desktop.mjs が import して窓の起動経路を darwin / win32 / wsl / linux に分岐する。
// WSL2 は process.platform が "linux" になるため、/proc/version の "microsoft" か
// WSL 固有の環境変数で「Windows ホスト上の Linux」を見分ける。
import { readFileSync } from "node:fs";

// WSL2 か？ linux 以外は常に false。env と /proc/version の両方を見る。
// 引数を渡せばテストから純粋に評価できる（既定は実環境を読む）。
export function isWsl({ platform = process.platform, env = process.env, procVersion } = {}) {
  if (platform !== "linux") return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  const text = procVersion ?? safeReadProcVersion();
  return /microsoft/i.test(text || "");
}

// "darwin" | "win32" | "wsl" | "linux" を返す。
export function detectPlatform(opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "win32";
  if (isWsl({ ...opts, platform })) return "wsl";
  return "linux";
}

function safeReadProcVersion() {
  try {
    return readFileSync("/proc/version", "utf8");
  } catch {
    return "";
  }
}
