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
const EVENTS_PATH = join(DATA_DIR, "events.ndjson");
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

server.listen(DEFAULT_PORT, HOST, () => {
  const url = `http://${HOST}:${DEFAULT_PORT}/`;
  console.log(`RPG Dev Adventure listening on ${url}`);
  if (process.argv.includes("--open")) openWindow(url);
});

async function handleHook(body) {
  const { state: nextState, effects, normalized } = reduceHookEvent(state, body);
  state = nextState;
  await saveState();
  await appendFile(EVENTS_PATH, `${JSON.stringify({ normalized, effects })}\n`);
  broadcast("state", { state, effects, event: normalized });
  return { ok: true, effects, state };
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
