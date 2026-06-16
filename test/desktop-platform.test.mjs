import test from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, isWsl } from "../scripts/desktop-platform.mjs";

// デスクトップ窓のプラットフォーム判定（純粋関数）。
// 実環境を読まないよう platform / env / procVersion を必ず注入する。

test("detectPlatform: macOS は darwin", () => {
  assert.equal(detectPlatform({ platform: "darwin", env: {}, procVersion: "" }), "darwin");
});

test("detectPlatform: Windows ネイティブは win32", () => {
  assert.equal(detectPlatform({ platform: "win32", env: {}, procVersion: "" }), "win32");
});

test("detectPlatform: linux + /proc/version に microsoft なら wsl", () => {
  const procVersion = "Linux version 5.15.0-microsoft-standard-WSL2 (oe-user@oe-host)";
  assert.equal(detectPlatform({ platform: "linux", env: {}, procVersion }), "wsl");
});

test("detectPlatform: linux + WSL_DISTRO_NAME なら wsl", () => {
  assert.equal(detectPlatform({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" }, procVersion: "" }), "wsl");
});

test("detectPlatform: linux + WSL_INTEROP なら wsl", () => {
  assert.equal(
    detectPlatform({ platform: "linux", env: { WSL_INTEROP: "/run/WSL/8_interop" }, procVersion: "" }),
    "wsl"
  );
});

test("detectPlatform: 素の linux は linux", () => {
  const procVersion = "Linux version 6.1.0-generic (builder@host)";
  assert.equal(detectPlatform({ platform: "linux", env: {}, procVersion }), "linux");
});

test("isWsl: linux 以外は常に false", () => {
  assert.equal(isWsl({ platform: "darwin", env: { WSL_DISTRO_NAME: "Ubuntu" }, procVersion: "microsoft" }), false);
  assert.equal(isWsl({ platform: "win32", env: { WSL_INTEROP: "x" }, procVersion: "microsoft" }), false);
});

test("isWsl: microsoft 判定は大文字小文字を問わない", () => {
  assert.equal(isWsl({ platform: "linux", env: {}, procVersion: "... Microsoft ..." }), true);
  assert.equal(isWsl({ platform: "linux", env: {}, procVersion: "... MICROSOFT ..." }), true);
});
