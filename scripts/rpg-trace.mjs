#!/usr/bin/env node
// 演出トレースの解析ツール（内部ログ）。
// reducer の emit ログ（.rpgdev/events.ndjson）とフロントの再生ログ（.rpgdev/playback.ndjson）を
// Hook 通し番号 origin.seq で突き合わせ、「どの Hook 由来の攻撃／世界遷移か」「二連続や欠落が
// どこで起きたか」を時系列で示す。
//
//   node scripts/rpg-trace.mjs            直近の Hook を時系列表示＋異常まとめ
//   node scripts/rpg-trace.mjs --all      全 Hook を表示
//   node scripts/rpg-trace.mjs --seq 42   seq 42 周辺だけを詳細表示
//   node scripts/rpg-trace.mjs --anomalies  異常まとめと再生順だけ
//
// RPGDEV_PROJECT_DIR（既定 cwd）の .rpgdev/ を読む。

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const PROJECT_DIR = resolve(process.env.RPGDEV_PROJECT_DIR || process.cwd());
const DATA_DIR = join(PROJECT_DIR, ".rpgdev");
const EVENTS_PATH = join(DATA_DIR, "events.ndjson");
const PLAYBACK_PATH = join(DATA_DIR, "playback.ndjson");

const args = process.argv.slice(2);
const showAll = args.includes("--all");
const anomaliesOnly = args.includes("--anomalies");
const focusSeq = args.includes("--seq") ? Number(args[args.indexOf("--seq") + 1]) : null;
const DEFAULT_LIMIT = 120;

const events = await readNdjson(EVENTS_PATH);
const playback = await readNdjson(PLAYBACK_PATH);

if (!events.length && !playback.length) {
  console.log(`トレースログが空です。${DATA_DIR} に events.ndjson / playback.ndjson がありません。`);
  console.log("サーバ起動中に Hook を流し、overlay 窓を開いた状態で操作すると記録されます。");
  process.exit(0);
}

// seq -> { hook, emitted[], play[], drop[], hold[], world[] }
const bySeq = new Map();
function slot(seq) {
  if (!bySeq.has(seq)) bySeq.set(seq, { seq, hook: null, emitted: [], play: [], drop: [], hold: [], world: [] });
  return bySeq.get(seq);
}

for (const line of events) {
  const seq = line?.normalized?.seq;
  if (seq == null) continue;
  const s = slot(seq);
  s.hook = {
    seq,
    id: line.normalized.id,
    event: line.normalized.event,
    provider: line.normalized.provider,
    tool: line.normalized.toolName || null,
    at: line.normalized.at
  };
  for (const effect of line.effects || []) {
    s.emitted.push({ tag: tagOf(effect), action: effect?.origin?.action ?? null, type: effect.type });
  }
}

for (const rec of playback) {
  const seq = rec?.origin?.seq;
  if (seq == null) continue;
  const s = slot(seq);
  if (rec.kind === "play") s.play.push(rec);
  else if (rec.kind === "drop") s.drop.push(rec);
  else if (rec.kind === "hold") s.hold.push(rec);
  else if (rec.kind === "world") s.world.push(rec);
  if (!s.hook) s.hook = { seq, ...rec.origin }; // emit ログが無い（窓だけ起動）の場合のフォールバック
}

const seqs = [...bySeq.keys()].sort((a, b) => a - b);

// --- 異常検出 ---

// 1) 実際の再生順（クライアント時刻 t, 連番 n でソート）で、同じ攻撃タグが連続したら「二連続」。
const allPlays = playback
  .filter((r) => r.kind === "play")
  .sort((a, b) => (a.t - b.t) || (a.n - b.n));
const consecutive = [];
for (let i = 1; i < allPlays.length; i += 1) {
  const prev = allPlays[i - 1];
  const cur = allPlays[i];
  if (isAttack(cur.tag) && cur.tag === prev.tag) {
    consecutive.push({ tag: cur.tag, a: prev, b: cur });
  }
}

// 2) emit されたのに再生も取りこぼし記録も無い effect（= 欠落／窓が見ていない）。synthetic は対象外。
const lost = [];
for (const s of bySeq.values()) {
  const accounted = new Set(
    [...s.play, ...s.drop].filter((r) => !r.synthetic && r.origin?.action != null).map((r) => r.origin.action)
  );
  for (const e of s.emitted) {
    if (e.action == null) continue;
    if (e.type === "step" || e.type === "hold") continue; // 即時・非戦闘の微小演出は欠落扱いしない
    if (!accounted.has(e.action)) lost.push({ seq: s.seq, action: e.action, tag: e.tag, hook: s.hook });
  }
}

// 3) 取りこぼし理由ごとの集計。
const dropReasons = new Map();
for (const r of playback) {
  if (r.kind !== "drop") continue;
  dropReasons.set(r.reason, (dropReasons.get(r.reason) || 0) + 1);
}

// --- 出力 ---

console.log(`== RPGDev 演出トレース ==`);
console.log(`project: ${PROJECT_DIR}`);
console.log(`events.ndjson: ${events.length} 行 / playback.ndjson: ${playback.length} 行 / hooks: ${seqs.length}`);
console.log("");

if (focusSeq != null) {
  printTimeline(seqs.filter((s) => Math.abs(s - focusSeq) <= 3));
} else if (!anomaliesOnly) {
  const shown = showAll ? seqs : seqs.slice(-DEFAULT_LIMIT);
  if (shown.length < seqs.length) console.log(`（直近 ${shown.length}/${seqs.length} hook。全件は --all）\n`);
  printTimeline(shown);
}

console.log("---- 再生順（実際に窓で再生された演出。t=クライアント時刻ms）----");
const renderShown = showAll ? allPlays : allPlays.slice(-DEFAULT_LIMIT);
let prevTag = null;
for (const p of renderShown) {
  const flag = isAttack(p.tag) && p.tag === prevTag ? "  ◀◀ 二連続" : "";
  console.log(`  ${p.t}  #${p.origin.seq} ${p.origin.event}${p.origin.tool ? `(${p.origin.tool})` : ""}  ${p.tag}${p.synthetic ? " [synthetic]" : ""}${flag}`);
  prevTag = p.tag;
}
console.log("");

console.log("---- 異常まとめ ----");
if (consecutive.length) {
  console.log(`▲ 同じ攻撃の二連続: ${consecutive.length} 件`);
  for (const c of consecutive) {
    console.log(`   ${c.tag}: #${c.a.origin.seq}(${c.a.origin.event}) → #${c.b.origin.seq}(${c.b.origin.event})  Δ${c.b.t - c.a.t}ms`);
  }
} else {
  console.log("・同じ攻撃の二連続: なし");
}

if (lost.length) {
  console.log(`▲ emit されたが再生も取りこぼし記録も無い演出: ${lost.length} 件（窓が閉じていた可能性 or 欠落）`);
  for (const l of lost.slice(-30)) {
    console.log(`   #${l.seq}.${l.action} ${l.tag}  (${l.hook?.event}${l.hook?.tool ? `/${l.hook.tool}` : ""})`);
  }
} else {
  console.log("・emit したのに記録の無い演出: なし");
}

if (dropReasons.size) {
  console.log("・取りこぼし（理由別）:");
  for (const [reason, n] of [...dropReasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${reason}: ${n}`);
  }
} else {
  console.log("・取りこぼし: なし");
}

// --- helpers ---

function printTimeline(list) {
  for (const seq of list) {
    const s = bySeq.get(seq);
    const h = s.hook || {};
    const head = `#${seq} ${h.at || ""} ${h.provider || "?"}.${h.event || "?"}${h.tool ? `(${h.tool})` : ""}`;
    console.log(head);
    if (s.emitted.length) console.log(`   emit : ${s.emitted.map((e) => e.tag).join(", ")}`);
    if (s.play.length) console.log(`   play : ${s.play.map((p) => p.tag + (p.synthetic ? "*" : "")).join(", ")}`);
    if (s.hold.length) console.log(`   hold : ${s.hold.map((p) => `${p.tag}(${p.wait}ms)`).join(", ")}`);
    if (s.drop.length) console.log(`   drop : ${s.drop.map((p) => `${p.tag}<${p.reason}>`).join(", ")}`);
    if (s.world.length) console.log(`   world: ${s.world.map((w) => `${w.field} ${w.from}→${w.to}`).join(", ")}`);
  }
  console.log("");
}

function tagOf(effect) {
  if (!effect) return "?";
  if (effect.type === "attack") {
    if (effect.kind === "ally") return `attack:ally:${effect.allyElement || "spirit"}`;
    if (effect.kind === "skill") return `attack:skill:${effect.skill || "?"}`;
    return "attack:normal";
  }
  return effect.type;
}

function isAttack(tag) {
  return typeof tag === "string" && tag.startsWith("attack:");
}

async function readNdjson(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // 壊れた行は黙って捨てず、件数だけ stderr に出す（解析の握りつぶし防止）。
      process.stderr.write(`[rpg-trace] skip unparsable line in ${path}\n`);
    }
  }
  return out;
}
