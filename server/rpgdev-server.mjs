#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, appendFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInitialState, reduceHookEvent } from "./adventure-state.mjs";

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROJECT_DIR = resolve(process.env.RPGDEV_PROJECT_DIR || process.cwd());
const PUBLIC_DIR = join(PACKAGE_ROOT, "public");
const DATA_DIR = join(PROJECT_DIR, ".rpgdev");
const STATE_PATH = join(DATA_DIR, "state.json");
const EVENTS_PATH = join(DATA_DIR, "events.ndjson"); // reducer の emit ログ（{normalized, effects}）
const PLAYBACK_PATH = join(DATA_DIR, "playback.ndjson"); // フロントの再生/取りこぼしログ（由来 Hook 付き）
const DEFAULT_PORT = Number(process.env.RPGDEV_PORT || 37373);
const HOST = process.env.RPGDEV_HOST || "127.0.0.1";
const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".wav", "audio/wav"],
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".ogg", "audio/ogg"]
]);

let state = createInitialState();
let clients = new Set();

await mkdir(DATA_DIR, { recursive: true });
await loadState();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${DEFAULT_PORT}`}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, { ok: true, state: state.phase });
    }

    if (request.method === "GET" && url.pathname === "/state") {
      return json(response, state);
    }

    if (request.method === "GET" && url.pathname === "/events") {
      return attachSse(request, response);
    }

    if (request.method === "POST" && url.pathname === "/hook") {
      const body = await readJsonBody(request);
      const result = await handleHook(body);
      return json(response, result);
    }

    if (request.method === "POST" && url.pathname === "/trace") {
      const body = await readJsonBody(request);
      await appendPlayback(body);
      return json(response, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/control/reset") {
      state = createInitialState();
      await saveState();
      broadcast("state", { state, effects: [{ type: "reset" }] });
      return json(response, { ok: true, state });
    }

    if (request.method === "POST" && url.pathname === "/control/demo") {
      const demoEvent = await readJsonBody(request);
      const result = await handleHook(demoEvent);
      return json(response, result);
    }

    if (request.method === "GET") {
      return serveStatic(url.pathname, response);
    }

    response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
  } catch (error) {
    await appendFile(join(DATA_DIR, "server-errors.log"), `${new Date().toISOString()} ${error.stack || error}\n`);
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
  }
});

// 二重起動防止：同ポートで既にサーバが居れば、後発インスタンスは綺麗に退場する。
// （複数フックの ensureServer が競合して二重 spawn しても、ポートを握れた1つだけが生き残る。
//  握れなかった側は EADDRINUSE をクラッシュさせず、既存ありと明示して exit 0 する＝成功偽装はしない。）
server.on("error", async (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`RPG Dev server: ${HOST}:${DEFAULT_PORT} is already serving; this duplicate instance exits.`);
    process.exit(0);
  }
  try {
    await appendFile(join(DATA_DIR, "server-errors.log"), `${new Date().toISOString()} listen ${error.stack || error}\n`);
  } catch {}
  process.exit(1);
});

server.listen(DEFAULT_PORT, HOST, () => {
  const url = `http://${HOST}:${DEFAULT_PORT}/`;
  console.log(`RPG Dev Adventure listening on ${url}`);
  if (process.argv.includes("--open")) openWindow(url);
});

const recentHookIds = []; // 冪等化用：直近に処理した Hook id（再送/二重配達で二重処理しない）
const RECENT_HOOK_IDS_MAX = 256;

async function handleHook(body) {
  // 冪等化：同じ id の Hook が二重配達されたら無視する（多エージェント/再送で二重出現させない）。
  const id = body && body.id;
  if (id && recentHookIds.includes(id)) {
    return { ok: true, duplicate: true, effects: [], state };
  }
  if (id) {
    recentHookIds.push(id);
    if (recentHookIds.length > RECENT_HOOK_IDS_MAX) recentHookIds.shift();
  }
  // ペーシングの基準時刻はサーバー（唯一の頭）が決める。Date.now() を注入し、event.at は使わない。
  const { state: nextState, effects, normalized } = reduceHookEvent(state, body, Date.now());
  state = nextState;
  await saveState();
  await appendFile(EVENTS_PATH, `${JSON.stringify({ normalized, effects })}\n`);
  broadcast("state", { state, effects, event: normalized });
  return { ok: true, effects, state };
}

// フロント（overlay.js）が実際に再生/取りこぼした演出を内部ログへ追記する。
// 1 レコード（オブジェクト）または配列を受け付ける。各行に受信時刻を添える。
async function appendPlayback(body) {
  const records = Array.isArray(body) ? body : Array.isArray(body?.records) ? body.records : [body];
  const receivedAt = new Date().toISOString();
  const lines = records
    .filter((record) => record && typeof record === "object")
    .map((record) => JSON.stringify({ ...record, receivedAt }))
    .join("\n");
  if (lines) await appendFile(PLAYBACK_PATH, `${lines}\n`);
}

function attachSse(request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  response.write(`event: state\ndata: ${JSON.stringify({ state, effects: [] })}\n\n`);
  clients.add(response);
  request.on("close", () => clients.delete(response));
}

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}

async function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const target = normalize(join(PUBLIC_DIR, safePath));
  if (target !== PUBLIC_DIR && !target.startsWith(`${PUBLIC_DIR}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "content-type": MIME.get(extname(target)) || "application/octet-stream"
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function loadState() {
  try {
    state = JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    state = createInitialState();
  }
}

async function saveState() {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

function json(response, payload) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function openWindow(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(opener, args, { detached: true, stdio: "ignore" });
  child.unref();
}
