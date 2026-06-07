#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROJECT_DIR = resolve(process.env.RPGDEV_PROJECT_DIR || process.cwd());
const DATA_DIR = join(PROJECT_DIR, ".rpgdev");
const LOG_PATH = join(DATA_DIR, "hook-errors.log");
const PORT = Number(process.env.RPGDEV_PORT || 37373);
const HOST = process.env.RPGDEV_HOST || "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const [provider = "manual", event = "Unknown"] = process.argv.slice(2);

await mkdir(DATA_DIR, { recursive: true });

try {
  const raw = await readStdinJson();
  await ensureServer();
  const payload = {
    id: hookId(provider, event), // Hook 個体 ID（演出トレースの由来識別子。サーバ側 seq と対で使う）
    provider,
    event,
    raw,
    at: new Date().toISOString()
  };
  await postJson(`${BASE_URL}/hook`, payload);

  if (event === "UserPromptSubmit") {
    launchDesktopWindow();
  }
} catch (error) {
  await appendFile(LOG_PATH, `${new Date().toISOString()} ${error.stack || error}\n`);
  console.error(`[rpgdev-hook] ${error.message || error}`);
  process.exitCode = 1;
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

async function health() {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Hook POST failed: ${response.status} ${await response.text()}`);
  }
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { unparsedStdin: text };
  }
}

function launchDesktopWindow() {
  const child = spawn(process.execPath, [join(PACKAGE_ROOT, "scripts", "desktop.mjs"), "--from-hook"], {
    cwd: PACKAGE_ROOT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, RPGDEV_PORT: String(PORT), RPGDEV_HOST: HOST, RPGDEV_PROJECT_DIR: PROJECT_DIR }
  });
  child.unref();
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

// 由来が読み取れる Hook ID。例: claude.PreToolUse.lq3k9x-a1b2c3。
// プロセス境界を跨いでも一意（時刻 36 進＋乱数）。サーバの seq が順序の正準キー、これは個体識別。
function hookId(provider, event) {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 8);
  return `${provider}.${event}.${time}-${rand}`;
}
