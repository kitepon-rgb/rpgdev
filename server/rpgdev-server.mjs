#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, appendFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInitialState, MONSTER_CATALOGS, reduceHookEvent } from "./adventure-state.mjs";

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
  [".ogg", "audio/ogg"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"]
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

    if (request.method === "POST" && url.pathname === "/control/counter-hit") {
      // フロント(実クロック)が反撃で精霊に当てた通知。サーバーがライフ確定・退場を司る（要件4）。
      const body = await readJsonBody(request);
      const result = await handleCounterHit(body);
      return json(response, result);
    }

    if (request.method === "POST" && url.pathname === "/control/reset") {
      state = createInitialState();
      await saveState();
      broadcast("state", { state, effects: [{ type: "reset" }] });
      return json(response, { ok: true, state });
    }

    if (request.method === "POST" && url.pathname === "/control/return-town") {
      // 手動「街に戻る」：合成 SessionStart を流して townReset（敵/精霊/クエストをクリア・オーナー解放・phase=idle）。
      // 無反応オーナーで冒険が固まった時の即時復旧（reducer の時間切れ自動解除の手動版）。既存パイプ（保存/ブロードキャスト/トレース）に乗る。
      const result = await handleHook({ provider: "system", event: "SessionStart", raw: {} });
      return json(response, result);
    }

    if (request.method === "POST" && url.pathname === "/control/shutdown") {
      // ハブをきれいに停止する（タスクトレイ常駐の「終了」用）。レスポンスを返してから exit する。
      json(response, { ok: true, shuttingDown: true });
      setTimeout(() => process.exit(0), 120);
      return;
    }

    if (request.method === "POST" && url.pathname === "/control/layout-spirits") {
      const result = await showSpiritLayoutPreview();
      return json(response, result);
    }

    if (request.method === "POST" && url.pathname === "/control/layout-monster") {
      const body = await readJsonBody(request);
      const result = await showMonsterLayoutPreview(body);
      return json(response, result);
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
  if (error.code === "EADDRNOTAVAIL") {
    // 非ループバック IP（例: Windows の WSL アダプタ IP）が現在この機に割り当たっていない。
    // 沈黙フォールバックせず明確に落とす（呼び出し側が住所を取り直して再起動する）。
    console.error(
      `RPG Dev server: cannot bind ${HOST}:${DEFAULT_PORT} (address not available on this host). ` +
        "The hub binds the WSL-adapter IP on Windows; if WSL isn't up or the IP changed, restart it or set RPGDEV_HOST."
    );
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
  state = { ...nextState, layoutPreview: false };
  await saveState();
  await appendFile(EVENTS_PATH, `${JSON.stringify({ normalized, effects })}\n`);
  broadcast("state", { state, effects, event: normalized });
  return { ok: true, effects, state };
}

const recentCounterIds = []; // 反撃ヒットの冪等化（Hook id とは別名前空間にして id 衝突を避ける。再送/複数窓で二重減算しない）
const RECENT_COUNTER_IDS_MAX = 256;

// フロント(overlay.js の反撃2秒ループ)が精霊に反撃を当てた時に POST /control/counter-hit で届く。
// サーバー(唯一の頭)が CounterHit 合成イベントを reducer に流し、ライフ減算・0退場を確定して再 broadcast する（要件4）。
// 反撃のタイミング/対象選定はフロント駆動（reducer はタイマーを持たない＝§12）、ライフの真実だけサーバー権威。
async function handleCounterHit(body) {
  const hitId = body && body.hitId;
  const allyId = body && body.allyId;
  if (!allyId) return { ok: false, error: "missing_allyId", state };
  // 冪等化：同じ hitId の二重配達は無視（二重減算防止）。Hook の recentHookIds とは別リング。
  if (hitId && recentCounterIds.includes(hitId)) {
    return { ok: true, duplicate: true, effects: [], state };
  }
  if (hitId) {
    recentCounterIds.push(hitId);
    if (recentCounterIds.length > RECENT_COUNTER_IDS_MAX) recentCounterIds.shift();
  }
  const event = { id: hitId || `counter-${Date.now()}`, event: "CounterHit", provider: "system", allyId, raw: { allyId } };
  const { state: nextState, effects, normalized } = reduceHookEvent(state, event, Date.now());
  state = nextState;
  await saveState();
  await appendFile(EVENTS_PATH, `${JSON.stringify({ normalized, effects })}\n`);
  broadcast("state", { state, effects, event: normalized });
  return { ok: true, effects, state };
}

async function showSpiritLayoutPreview() {
  const now = Date.now();
  const monster = {
    id: `layout-monster-${now}`,
    label: "Layout Orc",
    status: "in_progress",
    name: "Layout Orc",
    element: "layout",
    sprite: "orc",
    stage: "field",
    counterEffect: "blunt",
    maxHp: 999999,
    hp: 999999,
    dying: false,
    wild: true,
    hits: 0,
    linkedTodo: true,
    pendingDefeat: false,
    appearedAt: now
  };
  state = {
    ...state,
    active: true,
    phase: "battle",
    layoutPreview: true,
    currentTrack: "battle",
    adventureStage: "field",
    lastSpawnAt: now,
    lastDefeatAt: 0,
    quest: [{ label: "精霊4体レイアウト確認", status: "in_progress", stage: "field" }],
    ownerSession: "layout-four-spirits",
    monsters: [monster],
    allies: [
      { id: `layout-ignis-${now}`, name: "Ignis", sprite: "ally-fire", element: "fire", life: 5, appearedAt: now },
      { id: `layout-aqua-${now}`, name: "Aqua", sprite: "ally-water-facing-slit", element: "water", life: 5, appearedAt: now },
      { id: `layout-sylph-${now}`, name: "Sylph", sprite: "ally-wind", element: "wind", life: 5, appearedAt: now },
      { id: `layout-terra-${now}`, name: "Terra", sprite: "ally-earth", element: "earth", life: 5, appearedAt: now }
    ],
    lastEvent: {
      id: `layout-four-spirits-${now}`,
      at: new Date(now).toISOString(),
      sessionId: "layout-four-spirits",
      provider: "manual",
      event: "LayoutPreview",
      toolName: null,
      summary: "精霊4体レイアウト確認",
      todoItems: null,
      exitCode: null,
      raw: { cwd: PROJECT_DIR },
      now,
      seq: state.hookSeq || 0
    }
  };
  if (!Array.isArray(state.log)) state.log = [];
  state.log.push({
    id: `${now}-layout-four-spirits`,
    seq: state.hookSeq || 0,
    at: new Date(now).toISOString(),
    type: "layout_preview",
    message: "精霊4体レイアウト確認",
    provider: "manual",
    event: "LayoutPreview"
  });
  state.log = state.log.slice(-100);
  const effects = [{ type: "layout_preview" }];
  await saveState();
  broadcast("state", { state, effects });
  return { ok: true, effects, state };
}

async function showMonsterLayoutPreview(body = {}) {
  const now = Date.now();
  const stage = ["field", "dungeon", "castle"].includes(body.stage) ? body.stage : "dungeon";
  const catalog = MONSTER_CATALOGS[stage] || MONSTER_CATALOGS.dungeon;
  const requested = String(body.sprite || body.name || "").toLowerCase();
  const index = Number.isInteger(body.index) ? body.index : Number.parseInt(body.index, 10);
  const template = catalog.find((monster) => (
    monster.sprite.toLowerCase() === requested || monster.name.toLowerCase() === requested
  )) || catalog[index] || catalog[0];
  const track = stage === "castle" ? "castle-battle" : stage === "dungeon" ? "dungeon-battle" : "battle";
  const monster = {
    id: `layout-monster-${stage}-${template.sprite}-${now}`,
    label: template.name,
    status: "in_progress",
    name: template.name,
    element: template.element,
    sprite: template.sprite,
    stage,
    counterEffect: template.counterEffect,
    maxHp: template.hp,
    hp: template.hp,
    dying: false,
    wild: true,
    hits: 0,
    linkedTodo: true,
    pendingDefeat: false,
    appearedAt: now
  };
  state = {
    ...state,
    active: true,
    phase: "battle",
    layoutPreview: true,
    currentTrack: track,
    adventureStage: stage,
    lastSpawnAt: now,
    lastDefeatAt: 0,
    quest: [{ label: `${stage} monster layout: ${template.name}`, status: "in_progress", stage }],
    ownerSession: "layout-monster-preview",
    monsters: [monster],
    allies: [],
    lastEvent: {
      id: `layout-monster-${stage}-${template.sprite}-${now}`,
      at: new Date(now).toISOString(),
      sessionId: "layout-monster-preview",
      provider: "manual",
      event: "LayoutMonsterPreview",
      toolName: null,
      summary: `${stage} monster layout: ${template.name}`,
      todoItems: null,
      exitCode: null,
      raw: { cwd: PROJECT_DIR },
      now,
      seq: state.hookSeq || 0
    }
  };
  if (!Array.isArray(state.log)) state.log = [];
  state.log.push({
    id: `${now}-layout-monster`,
    seq: state.hookSeq || 0,
    at: new Date(now).toISOString(),
    type: "layout_monster_preview",
    message: `${stage}: ${template.name}`,
    provider: "manual",
    event: "LayoutMonsterPreview"
  });
  state.log = state.log.slice(-100);
  const effects = [{ type: "monster_appeared", monster }];
  await saveState();
  broadcast("state", { state, effects });
  return { ok: true, stage, monster, available: catalog.map((entry) => ({ name: entry.name, sprite: entry.sprite })), effects, state };
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
    const persisted = JSON.parse(await readFile(STATE_PATH, "utf8"));
    // dev 用レイアウトプレビュー（/control/layout-spirits|layout-monster）が保存された状態は
    // 起動時に復元しない。さもないと偽の戦闘＋ロックされた owner（quest 更新不能）として
    // 蘇り、再起動でいきなりプレビューの敵から始まってしまう。クリーンに開始する。
    state = isLayoutPreviewState(persisted) ? createInitialState() : persisted;
  } catch {
    state = createInitialState();
  }
}

// 永続化された状態が dev レイアウトプレビュー由来か。owner sentinel（"layout-..."）または
// layoutPreview フラグで判定（layoutPreview は実 Hook で false 化されるので owner も見る）。
function isLayoutPreviewState(persisted) {
  if (!persisted || typeof persisted !== "object") return false;
  if (persisted.layoutPreview === true) return true;
  return typeof persisted.ownerSession === "string" && persisted.ownerSession.startsWith("layout-");
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
