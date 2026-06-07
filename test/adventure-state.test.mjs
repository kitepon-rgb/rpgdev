import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  reduceHookEvent,
  detectFailure,
  normalizeHookEvent,
  __setChance,
  __setNow
} from "../server/adventure-state.mjs";

// 設計: ランダムエンカウント モデル。
// モンスターはツール使用時に確率で出現するエンカウント。TODO（クエスト）は表示用一覧＋討伐条件。

// 各 reduceHookEvent 呼び出しを十分離れたサーバー時刻にする自動クロック（+10s/呼び出し）。
// これで出現クールダウン(4s)/最小間隔(2s)/最低在席時間(4s)が常に満たされ、ペーシング非依存の
// 既存テストは従来どおり振る舞う。ペーシング自体を検証するテストは reduceHookEvent に now を明示で渡す。
function autoClock(start = 1_000_000, step = 10_000) {
  let t = start;
  return () => (t += step);
}

// 既定ではゲーム乱数（出現・増援）を無効化して決定的にする。
// 乱数挙動を検証するテストだけ __setChance(...) で上書きする（id 生成は Math.random のまま＝一意）。
beforeEach(() => {
  __setChance(() => 0.99);
  __setNow(autoClock());
});
afterEach(() => {
  __setChance(null);
  __setNow(null);
});

function todoWrite(todos) {
  return { provider: "claude", event: "PostToolUse", raw: { tool_name: "TodoWrite", tool_input: { todos } } };
}
function updatePlan(plan) {
  return { provider: "codex", event: "PostToolUse", raw: { tool_name: "update_plan", tool_input: { plan } } };
}
function pre(tool = "Read") {
  return { provider: "claude", event: "PreToolUse", raw: { tool_name: tool } };
}
function post(tool = "Edit") {
  return { provider: "claude", event: "PostToolUse", raw: { tool_name: tool } };
}
// 連続して別の値を返す chance スタブ（使い切ったら 0.99＝出現も増援もしない）。
function chanceSeq(...vals) {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0.99);
}

test("UserPromptSubmit starts a turn in the field", () => {
  const { state, effects } = reduceHookEvent(createInitialState(), {
    provider: "claude",
    event: "UserPromptSubmit",
    raw: { prompt: "fix the bug" }
  });
  assert.equal(state.active, true);
  assert.equal(state.phase, "field");
  assert.equal(state.currentTrack, "adventure");
  assert.equal(state.turn, 1);
  assert.equal(effects[0].type, "adventure_started");
});

test("TodoWrite updates the quest list for display but does NOT spawn monsters", () => {
  const { state } = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "audit routes", status: "in_progress" },
      { content: "extract handlers", status: "pending" },
      { content: "add tests", status: "completed" }
    ])
  );
  assert.equal(state.monsters.length, 0, "TODO からはモンスターは湧かない");
  assert.deepEqual(state.quest, [
    { label: "audit routes", status: "in_progress", stage: "field" },
    { label: "extract handlers", status: "pending", stage: "dungeon" },
    { label: "add tests", status: "completed", stage: "castle" }
  ]);
  assert.equal(state.adventureStage, "field");
  // in_progress TODO があってもモンスターが居なければ戦闘ではない（探索）。
  assert.equal(state.phase, "field");
});

test("Codex update_plan also only updates the quest list, no monsters (provider parity)", () => {
  const { state } = reduceHookEvent(
    createInitialState(),
    updatePlan([
      { step: "audit routes", status: "in_progress" },
      { step: "add tests", status: "pending" }
    ])
  );
  assert.equal(state.monsters.length, 0);
  assert.equal(state.quest.length, 2);
  assert.deepEqual(state.quest.map((q) => q.stage), ["field", "dungeon"]);
});

test("with no TODO, UserPromptSubmit shows the user input as a single in_progress quest", () => {
  const r = reduceHookEvent(createInitialState(), {
    provider: "claude",
    event: "UserPromptSubmit",
    raw: { prompt: "ログイン機能を作る" }
  });
  assert.deepEqual(r.state.quest, [
    { label: "ログイン機能を作る", status: "in_progress", synthetic: true, stage: "field" }
  ]);
  assert.equal(r.state.adventureStage, "field");
});

test("quest stages split TODOs across field, dungeon, and castle with smaller tail stages", () => {
  const cases = [
    { count: 1, stages: ["field"] },
    { count: 2, stages: ["field", "dungeon"] },
    { count: 3, stages: ["field", "dungeon", "castle"] },
    { count: 4, stages: ["field", "field", "dungeon", "castle"] },
    { count: 5, stages: ["field", "field", "dungeon", "dungeon", "castle"] }
  ];

  for (const { count, stages } of cases) {
    const todos = Array.from({ length: count }, (_, index) => ({
      content: `task ${index + 1}`,
      status: index === 0 ? "in_progress" : "pending"
    }));
    const { state } = reduceHookEvent(createInitialState(), todoWrite(todos));
    assert.deepEqual(state.quest.map((q) => q.stage), stages, `${count} TODO stage split`);
    assert.equal(state.adventureStage, "field");
  }
});

test("adventureStage follows the first unfinished TODO stage", () => {
  const { state } = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "task 1", status: "completed" },
      { content: "task 2", status: "completed" },
      { content: "task 3", status: "in_progress" },
      { content: "task 4", status: "pending" },
      { content: "task 5", status: "pending" }
    ])
  );
  assert.deepEqual(state.quest.map((q) => q.stage), ["field", "field", "dungeon", "dungeon", "castle"]);
  assert.equal(state.adventureStage, "dungeon");
});

test("Codex update_plan uses the same quest stage split as TodoWrite", () => {
  const plan = Array.from({ length: 5 }, (_, index) => ({
    step: `step ${index + 1}`,
    status: index < 4 ? "completed" : "in_progress"
  }));
  const { state } = reduceHookEvent(createInitialState(), updatePlan(plan));
  assert.deepEqual(state.quest.map((q) => q.stage), ["field", "field", "dungeon", "dungeon", "castle"]);
  assert.equal(state.adventureStage, "castle");
});

test("stage-specific BGM is used for dungeon and castle exploration and battles", () => {
  let dungeon = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "task 1", status: "completed" },
      { content: "task 2", status: "completed" },
      { content: "task 3", status: "in_progress" },
      { content: "task 4", status: "pending" },
      { content: "task 5", status: "pending" }
    ])
  );
  assert.equal(dungeon.state.currentTrack, "dungeon-adventure");
  __setChance(chanceSeq(0, 0));
  dungeon = reduceHookEvent(dungeon.state, pre());
  assert.equal(dungeon.state.currentTrack, "dungeon-battle");

  let castle = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "task 1", status: "completed" },
      { content: "task 2", status: "completed" },
      { content: "task 3", status: "completed" },
      { content: "task 4", status: "completed" },
      { content: "task 5", status: "in_progress" }
    ])
  );
  assert.equal(castle.state.currentTrack, "castle-adventure");
  __setChance(chanceSeq(0, 0));
  castle = reduceHookEvent(castle.state, pre());
  assert.equal(castle.state.currentTrack, "castle-battle");
});

test("field encounters use the original field monster catalog", () => {
  __setChance(chanceSeq(0, 0.74)); // spawn, then floor(0.74 * 4) => Orc
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, pre());
  const monster = r.state.monsters[0];
  assert.equal(monster.stage, "field");
  assert.equal(monster.sprite, "orc");
  assert.equal(monster.counterEffect, "slash");
  assert.ok(["slime", "goblin", "orc", "ogre"].includes(monster.sprite));
});

test("dungeon encounters use the dungeon monster catalog", () => {
  let r = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "task 1", status: "completed" },
      { content: "task 2", status: "completed" },
      { content: "task 3", status: "in_progress" },
      { content: "task 4", status: "pending" },
      { content: "task 5", status: "pending" }
    ])
  );
  __setChance(chanceSeq(0, 0.99)); // spawn, then final dungeon catalog entry
  r = reduceHookEvent(r.state, pre());
  const monster = r.state.monsters[0];
  assert.equal(monster.stage, "dungeon");
  assert.equal(monster.sprite, "succubus");
  assert.equal(monster.counterEffect, "magic");
  assert.ok(["skeleton", "ghoul", "witch", "grim-reaper", "succubus"].includes(monster.sprite));
});

test("castle encounters exclude dragon and demon-lord before the final TODO or when fewer than four TODOs exist", () => {
  let tooShort = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "task 1", status: "completed" },
      { content: "task 2", status: "completed" },
      { content: "task 3", status: "in_progress" }
    ])
  );
  assert.equal(tooShort.state.adventureStage, "castle");
  __setChance(chanceSeq(0, 0.34)); // would be demon-lord in the full 6-entry catalog
  tooShort = reduceHookEvent(tooShort.state, pre());
  assert.equal(tooShort.state.monsters[0].sprite, "dark-mage");

  let notFinal = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "task 1", status: "completed" },
      { content: "task 2", status: "completed" },
      { content: "task 3", status: "completed" },
      { content: "task 4", status: "completed" },
      { content: "task 5", status: "in_progress" },
      { content: "task 6", status: "pending" }
    ])
  );
  assert.equal(notFinal.state.adventureStage, "castle");
  __setChance(chanceSeq(0, 0.34)); // would be demon-lord if finalTodoOnly were not filtered
  notFinal = reduceHookEvent(notFinal.state, pre());
  assert.equal(notFinal.state.monsters[0].sprite, "dark-mage");
});

test("castle encounters can include dragon and demon-lord only on the final castle TODO with at least four TODOs", () => {
  const finalCastleTodos = [
    { content: "task 1", status: "completed" },
    { content: "task 2", status: "completed" },
    { content: "task 3", status: "completed" },
    { content: "task 4", status: "in_progress" }
  ];

  let dragon = reduceHookEvent(createInitialState(), todoWrite(finalCastleTodos));
  assert.equal(dragon.state.adventureStage, "castle");
  __setChance(chanceSeq(0, 0.2)); // floor(0.2 * 6) => Dragon
  dragon = reduceHookEvent(dragon.state, pre());
  assert.equal(dragon.state.monsters[0].sprite, "dragon");
  assert.equal(dragon.state.monsters[0].counterEffect, "magic");

  let demonLord = reduceHookEvent(createInitialState(), todoWrite(finalCastleTodos));
  __setChance(chanceSeq(0, 0.34)); // floor(0.34 * 6) => Demon Lord
  demonLord = reduceHookEvent(demonLord.state, pre());
  assert.equal(demonLord.state.monsters[0].sprite, "demon-lord");
  assert.equal(demonLord.state.monsters[0].counterEffect, "magic");
});

test("a real TodoWrite replaces the synthetic user-input quest", () => {
  let r = reduceHookEvent(createInitialState(), {
    provider: "claude",
    event: "UserPromptSubmit",
    raw: { prompt: "作業する" }
  });
  assert.equal(r.state.quest.length, 1);
  assert.equal(r.state.quest[0].synthetic, true);
  r = reduceHookEvent(
    r.state,
    todoWrite([
      { content: "task A", status: "in_progress" },
      { content: "task B", status: "pending" }
    ])
  );
  assert.equal(r.state.quest.length, 2);
  assert.ok(!r.state.quest[0].synthetic, "TodoWrite で本物の TODO に置き換わる");
});

test("an encounter during the synthetic (user-input) quest is NOT linked (treated as no-TODO)", () => {
  __setChance(chanceSeq(0, 0));
  let r = reduceHookEvent(createInitialState(), {
    provider: "claude",
    event: "UserPromptSubmit",
    raw: { prompt: "作業する" }
  });
  assert.equal(r.state.quest[0].synthetic, true);
  r = reduceHookEvent(r.state, pre()); // 出現
  assert.equal(r.state.monsters.length, 1);
  assert.equal(r.state.monsters[0].linkedTodo, false, "合成クエストは linkedTodo を立てない＝5撃/ターン終了で討伐");
});

test("a tool call can spawn an encounter (20%); never two at once", () => {
  __setChance(() => 0.1); // < 0.2 → 出現
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, pre());
  assert.equal(r.state.monsters.length, 1);
  assert.equal(r.state.monsters[0].wild, true);
  assert.equal(r.state.phase, "battle");
  r = reduceHookEvent(r.state, pre());
  assert.equal(r.state.monsters.length, 1, "同時に2体は出現しない");
});

test("no high roll = no encounter (peaceful exploration)", () => {
  // beforeEach の 0.99 で出現しない
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, pre());
  assert.equal(r.state.monsters.length, 0);
  assert.equal(r.state.phase, "field");
  assert.ok(r.effects.some((e) => e.type === "step"));
});

test("a no-TODO encounter is defeated after 5 hero SKILL attacks (PostToolUse); PreToolUse no longer attacks", () => {
  __setChance(chanceSeq(0, 0)); // 出現(gate0,select0)。以降0.99で増援なし・追加出現なし
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, pre()); // 出現だけ
  assert.equal(r.state.monsters.length, 1);
  assert.equal(r.state.monsters[0].linkedTodo, false);
  assert.equal(r.state.monsters[0].hits, 0, "出現の Hook では攻撃しない");
  __setChance(() => 0.99); // 増援なし
  // PreToolUse は通常攻撃を廃止＝ヒットを増やさない。
  r = reduceHookEvent(r.state, pre());
  assert.equal(r.state.monsters[0].hits, 0, "PreToolUse は攻撃しない＝ヒット増えない");
  // 討伐ヒットは PostToolUse スキル攻撃でのみ加算。5回で討伐。
  for (let i = 0; i < 4; i += 1) r = reduceHookEvent(r.state, post());
  assert.equal(r.state.monsters.length, 1, "4撃ではまだ生存");
  assert.equal(r.state.monsters[0].hits, 4);
  r = reduceHookEvent(r.state, post()); // hits=5 → 討伐
  assert.equal(r.state.monsters.length, 0, "スキル攻撃5回で討伐");
  assert.equal(r.state.defeatedCount, 1);
});

// --- ペーシング（唯一の頭＝サーバーが時刻で律速。多エージェントの洪水でも点滅させない）---
// これらは now を明示で渡してサーバー時刻を完全制御する。

test("5撃に達しても最低在席時間内は討伐せず保留(pendingDefeat)し、寿命経過後のスイープで討伐する", () => {
  const T0 = 1000;
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} }, T0);
  __setChance(chanceSeq(0, 0)); // 次の Pre で出現（wild）
  r = reduceHookEvent(r.state, pre(), T0 + 100); // 出現 appearedAt=T0+100
  assert.equal(r.state.monsters.length, 1);
  assert.equal(r.state.monsters[0].linkedTodo, false);
  __setChance(() => 0.99); // 以降 増援なし＝通常攻撃
  let t = T0 + 200;
  for (let i = 0; i < 5; i += 1) { r = reduceHookEvent(r.state, post(), t); t += 100; } // 寿命(4000ms)内に5撃
  assert.equal(r.state.monsters.length, 1, "5撃でも寿命前は討伐されない");
  assert.equal(r.state.monsters[0].pendingDefeat, true, "討伐は保留される");
  // 寿命経過後の次の任意の Hook でスイープ討伐される
  r = reduceHookEvent(r.state, pre(), T0 + 100 + 4000 + 1);
  assert.equal(r.state.monsters.length, 0, "寿命経過後のスイープで確定討伐");
  assert.equal(r.state.defeatedCount, 1);
});

test("討伐後 SPAWN_COOLDOWN 内は再出現しない／クールダウン明けは出現する", () => {
  const T0 = 1000;
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} }, T0);
  __setChance(chanceSeq(0, 0));
  r = reduceHookEvent(r.state, pre(), T0 + 100); // 出現 appearedAt=T0+100
  assert.equal(r.state.monsters.length, 1);
  r = reduceHookEvent(r.state, { provider: "claude", event: "Stop", raw: {} }, T0 + 5000); // 討伐 lastDefeatAt=T0+5000
  assert.equal(r.state.monsters.length, 0);
  assert.equal(r.state.lastDefeatAt, T0 + 5000);
  __setChance(() => 0); // 出現させたい（がクールダウンで弾かれる）
  r = reduceHookEvent(r.state, pre(), T0 + 5000 + 1000); // 討伐の1s後（<4s）
  assert.equal(r.state.monsters.length, 0, "クールダウン中は出現しない");
  r = reduceHookEvent(r.state, pre(), T0 + 5000 + 4001); // 4s経過後
  assert.equal(r.state.monsters.length, 1, "クールダウン明けは出現する");
});

test("Stop は最低在席時間内でも強制討伐する（ターンを跨がせない）", () => {
  const T0 = 1000;
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} }, T0);
  __setChance(chanceSeq(0, 0));
  r = reduceHookEvent(r.state, pre(), T0 + 100); // 出現 appearedAt=T0+100
  assert.equal(r.state.monsters.length, 1);
  r = reduceHookEvent(r.state, { provider: "claude", event: "Stop", raw: {} }, T0 + 500); // 寿命(4s)内
  assert.equal(r.state.monsters.length, 0, "Stop は寿命無視で討伐");
  assert.equal(r.state.phase, "complete");
});

test("新ターン(UserPromptSubmit)は出現クールダウンをリセットし、最初のエンカウントを律速しない", () => {
  const T0 = 1000;
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} }, T0);
  __setChance(chanceSeq(0, 0));
  r = reduceHookEvent(r.state, pre(), T0 + 100); // 出現
  r = reduceHookEvent(r.state, { provider: "claude", event: "Stop", raw: {} }, T0 + 5000); // 討伐 lastDefeatAt=T0+5000
  r = reduceHookEvent(r.state, { provider: "claude", event: "UserPromptSubmit", raw: {} }, T0 + 5100); // 新ターン
  assert.equal(r.state.lastDefeatAt, 0, "新ターンでクールダウンはリセット");
  __setChance(chanceSeq(0, 0));
  r = reduceHookEvent(r.state, pre(), T0 + 5200); // クールダウン内のタイミングでも出現できる
  assert.equal(r.state.monsters.length, 1, "新ターンの最初のエンカウントはクールダウンに阻まれない");
});

test("サーバー時計が逆転(now < appearedAt)しても pendingDefeat を取り残さず強制討伐する", () => {
  const T0 = 100000;
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} }, T0);
  __setChance(chanceSeq(0, 0));
  r = reduceHookEvent(r.state, pre(), T0 + 100); // 出現 appearedAt=T0+100
  __setChance(() => 0.99);
  let t = T0 + 200;
  for (let i = 0; i < 5; i += 1) { r = reduceHookEvent(r.state, post(), t); t += 100; } // 5撃→pendingDefeat（寿命内）
  assert.equal(r.state.monsters[0].pendingDefeat, true);
  // ここでサーバー時計が大きく巻き戻る（NTP step 等）→ now < appearedAt
  r = reduceHookEvent(r.state, pre(), T0 - 50000);
  assert.equal(r.state.monsters.length, 0, "時計逆転でも取り残さず討伐される");
  assert.equal(r.state.defeatedCount, 1);
});

test("a no-TODO encounter is cleared at turn end (Stop)", () => {
  __setChance(chanceSeq(0, 0));
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, pre());
  assert.equal(r.state.monsters.length, 1);
  r = reduceHookEvent(r.state, { provider: "claude", event: "Stop", raw: {} });
  assert.equal(r.state.monsters.length, 0, "ターン終了で討伐");
  assert.equal(r.state.phase, "complete");
});

test("an encounter spawned during an in_progress TODO is linked: survives attacks, defeated on TODO completion", () => {
  __setChance(chanceSeq(0, 0));
  let r = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  r = reduceHookEvent(r.state, pre()); // 出現（in_progress TODO 在り → linked）
  assert.equal(r.state.monsters[0].linkedTodo, true);
  __setChance(() => 0.99);
  for (let i = 0; i < 10; i += 1) r = reduceHookEvent(r.state, post());
  assert.equal(r.state.monsters.length, 1, "攻撃では討伐されない");
  r = reduceHookEvent(r.state, todoWrite([{ content: "task", status: "completed" }]));
  assert.equal(r.state.monsters.length, 0, "TODO 1項目の完了で討伐");
});

test("PreToolUse no longer attacks; PostToolUse = skill attack named after the tool (against the encounter)", () => {
  __setChance(chanceSeq(0, 0)); // 最初の Pre で出現させる（出現のみ）
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, pre()); // 出現
  assert.equal(r.state.monsters.length, 1);
  __setChance(() => 0.99); // 以降は増援なし
  const preRes = reduceHookEvent(r.state, pre("Grep")); // 攻撃しない
  assert.ok(!preRes.effects.some((e) => e.type === "attack"), "PreToolUse は攻撃 effect を出さない");
  const res = reduceHookEvent(preRes.state, post("Edit")); // スキル攻撃のみ
  const skill = res.effects.find((e) => e.type === "attack");
  assert.equal(skill.kind, "skill");
  assert.equal(skill.skill, "Edit");
});

test("PostToolUse skill name is tool_name based (PascalCase; MCP→server; command body ignored)", () => {
  const cases = [
    // Bash は中で何を実行しても tool_name のまま（コマンド/パッチ本文は見ない）。
    { tool_name: "Bash", tool_input: { command: "npm test" }, expected: "Bash" },
    // Codex apply_patch の command は "*** Begin Patch …"。技名が "***" にならないこと。
    { tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: x.txt\n" }, expected: "ApplyPatch" },
    { tool_name: "spawn_agent", expected: "SpawnAgent" },
    { tool_name: "view_image", expected: "ViewImage" },
    { tool_name: "Edit", expected: "Edit" },
    { tool_name: "WebFetch", expected: "WebFetch" },
    // MCP はサーバ名（動作の1つ手前の区画）を PascalCase、末尾 "mcp" は除去。
    { tool_name: "mcp__aiterm__pty_read", expected: "Aiterm" },
    { tool_name: "mcp__caveat__caveat_record", expected: "Caveat" },
    { tool_name: "mcp__node_repl__js", expected: "NodeRepl" },
    { tool_name: "mcp__codex_apps__x_hermes_mcp__generate_image", expected: "XHermes" }
  ];

  for (const { tool_name, tool_input, expected } of cases) {
    __setChance(chanceSeq(0, 0)); // 最初の Pre で出現させる（出現のみ）
    let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
    r = reduceHookEvent(r.state, pre()); // 出現
    const res = reduceHookEvent(r.state, {
      provider: "claude",
      event: "PostToolUse",
      raw: { tool_name, tool_input: tool_input || {} }
    });
    const skill = res.effects.find((e) => e.type === "attack" && e.kind === "skill");
    assert.equal(skill.skill, expected, `${tool_name} → ${expected}`);
  }
});

test("one Hook does exactly one action (spawn XOR summon XOR attack — never combined)", () => {
  // 出現の Hook は攻撃も召喚もしない
  __setChance(chanceSeq(0, 0));
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, pre()); // 出現のみ
  assert.ok(r.effects.some((e) => e.type === "monster_appeared"));
  assert.ok(!r.effects.some((e) => e.type === "attack"), "出現と攻撃は同時に起きない");
  assert.ok(!r.effects.some((e) => e.type === "ally_summon"), "出現と召喚は同時に起きない");

  // 戦闘中、召喚が起きる Hook は攻撃しない
  __setChance(() => 0); // 召喚を強制
  const summonR = reduceHookEvent(r.state, pre());
  assert.ok(summonR.effects.some((e) => e.type === "ally_summon"));
  assert.ok(!summonR.effects.some((e) => e.type === "attack"), "召喚と攻撃は同時に起きない");

  // 戦闘中、召喚しない PreToolUse は何も攻撃しない（通常攻撃廃止）
  __setChance(() => 0.99);
  const idleR = reduceHookEvent(r.state, pre());
  assert.ok(!idleR.effects.some((e) => e.type === "attack"), "PreToolUse は攻撃しない");
  assert.ok(!idleR.effects.some((e) => e.type === "ally_summon"), "確率を外せば召喚もしない");

  // 攻撃は PostToolUse スキル攻撃だけ
  const skillR = reduceHookEvent(r.state, post("Edit"));
  assert.ok(skillR.effects.some((e) => e.type === "attack" && e.kind === "skill"), "攻撃は PostToolUse スキルのみ");
});

test("defeating a monster makes all spirits vanish", () => {
  let r = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  __setChance(() => 0); // Pre 毎に増援（出現は在席で skip）／linked なので討伐されない
  for (let i = 0; i < 6; i += 1) r = reduceHookEvent(r.state, pre());
  assert.ok(r.state.allies.length > 0, "精霊が増援している");
  assert.equal(r.state.monsters.length, 1);
  __setChance(() => 0.99);
  r = reduceHookEvent(r.state, todoWrite([{ content: "task", status: "completed" }])); // 討伐
  assert.equal(r.state.monsters.length, 0);
  assert.equal(r.state.allies.length, 0, "撃破で精霊は全員消滅");
});

test("reinforcement summons at most one spirit per tool call, distinct elements, capped at 4", () => {
  let r = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  __setChance(() => 0); // 出現(初回のみ)・増援は毎回。選択は available 先頭＝毎回別属性
  for (let i = 0; i < 12; i += 1) {
    const before = r.state.allies.length;
    r = reduceHookEvent(r.state, pre());
    assert.ok(r.state.allies.length - before <= 1, "1ツール使用で精霊は最大1体しか増えない");
  }
  assert.equal(r.state.allies.length, 4, "上限4");
  assert.equal(new Set(r.state.allies.map((a) => a.element)).size, 4, "属性は全て異なる（重複なし）");
});

test("SubagentStart summons a spirit; SubagentStop returns the first spirit (FIFO), spurious Stop is silent", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(r.state.allies.length, 1);
  assert.ok(r.effects.some((e) => e.type === "ally_summon" && e.ally));
  const firstAllyId = r.state.allies[0].id;
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(r.state.allies.length, 2);
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStop", raw: {} });
  assert.equal(r.state.allies.length, 1);
  assert.ok(r.effects.some((e) => e.type === "ally_return" && e.allyId === firstAllyId));
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStop", raw: {} });
  assert.equal(r.state.allies.length, 0);
  const extra = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStop", raw: {} });
  assert.ok(!extra.effects.some((e) => e.type === "ally_return"));
});

test("PostToolUse emits ONLY the hero skill attack; spirit attacks are no longer reducer events (frontend-only)", () => {
  __setChance(chanceSeq(0, 0)); // linked エンカウントを1体出す（攻撃で倒れない）
  let base = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }])).state;
  base = reduceHookEvent(base, pre()).state; // 出現(linked)
  __setChance(() => 0.99); // 以降 増援/出現なし

  // 精霊を1体参戦させる（召喚自体は攻撃しない）。
  const withAlly = reduceHookEvent(base, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(withAlly.state.allies.length, 1);
  assert.ok(!withAlly.effects.some((e) => e.type === "attack"), "召喚は攻撃しない");

  const hpBefore = withAlly.state.monsters[0].hp;
  const res = reduceHookEvent(withAlly.state, post("Read"));
  // PostToolUse は勇者スキル攻撃のみ。精霊の追撃（kind:"ally"）は reducer から出さない＝フロント演出。
  const attacks = res.effects.filter((e) => e.type === "attack");
  assert.equal(attacks.length, 1, "攻撃 effect は勇者スキルの1つだけ");
  assert.equal(attacks[0].kind, "skill");
  assert.ok(!res.effects.some((e) => e.type === "attack" && e.kind === "ally"), "精霊の追撃 effect は出ない");
  // HP は勇者スキル分だけ減る（精霊は HP に影響しない）。精霊は在席したまま。
  assert.ok(res.state.monsters[0].hp < hpBefore, "勇者スキルで HP は減る");
  assert.equal(res.state.allies.length, 1, "精霊は在席し続ける（フロントで追撃演出）");
});

test("Claude failure (PostToolUseFailure) triggers a counter, not a spawn", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, {
    provider: "claude",
    event: "PostToolUseFailure",
    raw: { tool_name: "Bash", tool_input: { command: "npm test" } }
  });
  assert.ok(r.effects.some((e) => e.type === "counter"));
  assert.equal(r.state.monsters.length, 0);
});

test("a PostToolUse with a structured non-zero exit code triggers a counter", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, {
    provider: "manual",
    event: "PostToolUse",
    raw: { tool_name: "Bash", tool_input: { command: "npm test" }, tool_response: { exit_code: 1 } }
  });
  assert.ok(r.effects.some((e) => e.type === "counter"));
});

test("REAL Codex failure payloads carry no outcome, so failure is NOT detected (docs §7.2)", () => {
  const codexFail = normalizeHookEvent({
    provider: "codex",
    event: "PostToolUse",
    raw: { tool_name: "Bash", tool_input: { command: "sh -c 'echo BYE; exit 7'" }, tool_response: "BYE\n" }
  });
  assert.equal(detectFailure(codexFail), false);

  let r = reduceHookEvent(createInitialState(), { provider: "codex", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, {
    provider: "codex",
    event: "PostToolUse",
    raw: { tool_name: "Bash", tool_input: { command: "sh -c 'echo BYE; exit 7'" }, tool_response: "BYE\n" }
  });
  // 失敗検知されない＝counter ではない（敵不在なので step 扱い）
  assert.ok(!r.effects.some((e) => e.type === "counter"));
});

test("benign output containing the word 'error' is NOT a failure", () => {
  const event = normalizeHookEvent({
    provider: "claude",
    event: "PostToolUse",
    raw: { tool_name: "Read", tool_response: { exit_code: 0, content: "Error handling is documented in errors.md" } }
  });
  assert.equal(detectFailure(event), false);
});

test("Stop completes the turn and clears even a linked encounter", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  const clear = reduceHookEvent(r.state, { provider: "claude", event: "Stop", raw: {} });
  assert.equal(clear.state.phase, "complete");

  __setChance(chanceSeq(0, 0));
  let s = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  s = reduceHookEvent(s.state, pre()); // linked 出現
  __setChance(() => 0.99);
  const completed = reduceHookEvent(s.state, { provider: "claude", event: "Stop", raw: {} });
  assert.equal(completed.state.monsters.length, 0, "linked もターン終了で討伐する");
  assert.equal(completed.state.phase, "complete");
  assert.ok(completed.effects.some((e) => e.type === "monster_defeated"));
  assert.ok(completed.effects.some((e) => e.type === "turn_completed"));
});

test("every effect carries its origin Hook (seq, hookId, event, tool); seq increments per Hook", () => {
  // Hook CLI が付ける id がそのまま origin.hookId へ流れる。
  let r = reduceHookEvent(createInitialState(), {
    id: "claude.UserPromptSubmit.test-1",
    provider: "claude",
    event: "UserPromptSubmit",
    raw: { prompt: "go" }
  });
  assert.equal(r.state.hookSeq, 1, "最初の Hook で seq=1");
  assert.ok(r.effects.length > 0);
  r.effects.forEach((effect, index) => {
    assert.equal(effect.origin.seq, 1);
    assert.equal(effect.origin.hookId, "claude.UserPromptSubmit.test-1");
    assert.equal(effect.origin.event, "UserPromptSubmit");
    assert.equal(effect.origin.provider, "claude");
    assert.equal(effect.origin.action, index, "同一 Hook 内で action 連番が付く");
  });

  // 次の Hook で seq が +1 され、その effect の origin もそれを担ぐ（tool 名も入る）。
  __setChance(chanceSeq(0, 0)); // 出現させて effect を生む
  r = reduceHookEvent(r.state, {
    id: "claude.PreToolUse.test-2",
    provider: "claude",
    event: "PreToolUse",
    raw: { tool_name: "Read" }
  });
  assert.equal(r.state.hookSeq, 2, "2 つ目の Hook で seq=2");
  const appeared = r.effects.find((e) => e.type === "monster_appeared");
  assert.ok(appeared);
  assert.equal(appeared.origin.seq, 2);
  assert.equal(appeared.origin.tool, "Read");
});

test("spirits do not attack when there is no encounter (exploration)", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(r.state.phase, "field");
  r = reduceHookEvent(r.state, pre());
  assert.ok(r.effects.some((e) => e.type === "step"));
  assert.ok(!r.effects.some((e) => e.type === "attack"), "敵不在では攻撃は起きない");
  assert.ok(!r.effects.some((e) => e.type === "ally_summon"), "敵不在では増援召喚も起きない");
});

// --- 要件6: クエストは親(オーナー)セッション限定（spawned な別セッションに乗っ取らせない）---

// 動的オーナー用のセッション付きイベントビルダー（要件6→動的化）。
const promptBy = (sid, prompt) => ({ provider: "claude", event: "UserPromptSubmit", raw: { session_id: sid, prompt } });
const todoBy = (sid, todos) => ({
  provider: "claude",
  event: "PostToolUse",
  raw: { session_id: sid, tool_name: "TodoWrite", tool_input: { todos } }
});
const planBy = (sid, plan) => ({
  provider: "codex",
  event: "PostToolUse",
  raw: { session_id: sid, tool_name: "update_plan", tool_input: { plan } }
});
const subStartBy = (sid) => ({ provider: "claude", event: "SubagentStart", raw: { session_id: sid } });
const subStopBy = (sid) => ({ provider: "claude", event: "SubagentStop", raw: { session_id: sid } });
const stopBy = (sid) => ({ provider: "claude", event: "Stop", raw: { session_id: sid } });

test("素のプロンプト乗っ取りは防ぐが、アイドルなオーナー(synthetic のみ)からは別セッションの TODO が奪取する", () => {
  // A が最初に UserPromptSubmit → オーナー A、synthetic クエスト。
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業"));
  assert.equal(r.state.ownerSession, "A");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["親の作業"]);

  // B の素の UserPromptSubmit はクエストを乗っ取らない＝前進のみ（要件6のプロンプト保護は維持）。
  r = reduceHookEvent(r.state, promptBy("B", "spawned prompt"));
  assert.equal(r.state.ownerSession, "A", "素の非オーナー入力ではオーナーは変わらない");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["親の作業"]);
  assert.ok(r.effects.some((e) => e.type === "step"), "非オーナーの UserPromptSubmit は前進のみ");

  // オーナー A はアイドル（本物TODO/サブエージェント無し）なので、B の update_plan が奪取する。
  r = reduceHookEvent(r.state, planBy("B", [{ step: "B task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "B", "アイドルなオーナーからは TODO で奪取できる");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["B task"], "奪取後はそのセッションの TODO を表示");
});

test("TODOロック：オーナーが進行中の本物TODOを持つ間は、別セッションの TODO は奪取できない", () => {
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業"));
  r = reduceHookEvent(r.state, todoBy("A", [{ content: "A task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "A");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["A task"]);

  // A が作業中（in_progress の本物TODO）→ B の update_plan は奪取不可・クエスト不変。
  r = reduceHookEvent(r.state, planBy("B", [{ step: "B task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "A", "ロック中はオーナーを奪われない");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["A task"], "ロック中の非オーナーTODOはクエストを変えない");
});

test("サブエージェントロック：オーナーが稼働サブエージェントを持つ間は奪取不可、SubagentStop でアイドル化したら奪取可", () => {
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業")); // オーナーA・synthetic（本物TODOなし）
  r = reduceHookEvent(r.state, subStartBy("A")); // A 名義のサブエージェント稼働
  assert.equal(r.state.subagentCounts.A, 1);

  // 本物TODOは無いが A のサブエージェントが稼働中＝ロック → B の TODO は奪取不可。
  r = reduceHookEvent(r.state, planBy("B", [{ step: "B task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "A", "稼働サブエージェントがあれば奪取不可");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["親の作業"]);

  // SubagentStop で A の稼働数が 0 ＝アイドル → 次の B の TODO は奪取できる。
  r = reduceHookEvent(r.state, subStopBy("A"));
  assert.equal(r.state.subagentCounts.A, 0);
  r = reduceHookEvent(r.state, planBy("B", [{ step: "B task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "B", "サブエージェント完了でアイドル化したら奪取可");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["B task"]);
});

test("TODOロック解除：オーナーが全TODOを完了したら、別セッションの TODO が奪取できる", () => {
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業"));
  r = reduceHookEvent(r.state, todoBy("A", [{ content: "A task", status: "in_progress" }]));
  // 進行中 → ロック → B 奪取不可。
  r = reduceHookEvent(r.state, planBy("B", [{ step: "B task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "A");
  // A が完了 → アイドル化。
  r = reduceHookEvent(r.state, todoBy("A", [{ content: "A task", status: "completed" }]));
  assert.equal(r.state.ownerSession, "A");
  // 解除後は B が奪取できる。
  r = reduceHookEvent(r.state, planBy("B", [{ step: "B task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "B", "全TODO完了でロック解除→奪取可");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["B task"]);
});

test("ターン終了はオーナーの Stop だけ：非オーナーの Stop は親ターンを終わらせない／オーナーの Stop でオーナー解放", () => {
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業"));
  assert.equal(r.state.active, true);

  // 非オーナー B の Stop はターンを終わらせない（active 継続・オーナー継続）。
  r = reduceHookEvent(r.state, stopBy("B"));
  assert.equal(r.state.active, true, "非オーナーの Stop でターンは終わらない");
  assert.notEqual(r.state.phase, "complete");
  assert.equal(r.state.ownerSession, "A", "非オーナーの Stop でオーナーは解放されない");

  // オーナー A の Stop でターン終了＆オーナー/カウンタ解放。
  r = reduceHookEvent(r.state, stopBy("A"));
  assert.equal(r.state.phase, "complete", "オーナーの Stop でターン終了");
  assert.equal(r.state.ownerSession, null, "ターン終了でオーナーを手放す（安全弁）");
  assert.deepEqual(r.state.subagentCounts, {}, "ターン終了で稼働カウンタもクリア");
});

// 以下はレビュー（多視点＋敵対的検証ワークフロー）で見つかった抜けを塞ぐ回帰テスト。

test("オーナーStopで owner=null 化した後、野良の非オーナーStopは再びターンを終わらせない（要件5の穴の回帰）", () => {
  // バグ：isOwnerSession は owner==null で true を返すため、オーナーStop後の野良Stopが再 finishTurn して
  // 再活性化したモンスターを強制討伐していた。canEndTurn で塞ぐ。
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業"));
  r = reduceHookEvent(r.state, stopBy("A")); // オーナー終了 → owner=null, phase=complete
  assert.equal(r.state.ownerSession, null);

  // 野良の非オーナー B が PreToolUse で再活性化＆出現（onPreToolUse はオーナー非依存＝§12）。
  __setChance(chanceSeq(0, 0));
  r = reduceHookEvent(r.state, { provider: "codex", event: "PreToolUse", raw: { session_id: "B", tool_name: "Read" } });
  assert.equal(r.state.monsters.length, 1, "非オーナーのツール使用は出現する（§12）");

  // 野良の Stop（C）は owner=null でも finishTurn を呼ばず、モンスターを強制討伐しない。
  r = reduceHookEvent(r.state, stopBy("C"));
  assert.equal(r.state.monsters.length, 1, "owner=null でも野良Stopは強制討伐しない");
  assert.ok(!r.effects.some((e) => e.type === "turn_completed"), "野良Stopで turn_completed を再発しない");
  assert.ok(!r.effects.some((e) => e.type === "monster_defeated"), "野良Stopで強制討伐しない");
});

test("非オーナーの Stop は進行中のモンスターを強制討伐しない（要件5）", () => {
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業")); // owner A, active
  __setChance(chanceSeq(0, 0)); // 次の Pre で出現
  r = reduceHookEvent(r.state, pre());
  assert.equal(r.state.monsters.length, 1);

  r = reduceHookEvent(r.state, stopBy("B")); // 非オーナー Stop
  assert.equal(r.state.monsters.length, 1, "非オーナーStopでモンスターは消えない");
  assert.ok(!r.effects.some((e) => e.type === "monster_defeated"), "非オーナーStopは強制討伐しない");
  assert.ok(r.effects.some((e) => e.type === "step"), "非オーナーStopは step のみ");
});

test("SessionEnd も Stop と同じくオーナー限定でターン終了する", () => {
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業"));
  // 非オーナー B の SessionEnd はターンを終わらせない。
  r = reduceHookEvent(r.state, { provider: "claude", event: "SessionEnd", raw: { session_id: "B" } });
  assert.equal(r.state.active, true, "非オーナーの SessionEnd でターンは終わらない");
  assert.equal(r.state.ownerSession, "A");
  // オーナー A の SessionEnd はターン終了＆解放。
  r = reduceHookEvent(r.state, { provider: "claude", event: "SessionEnd", raw: { session_id: "A" } });
  assert.equal(r.state.phase, "complete", "オーナーの SessionEnd でターン終了");
  assert.equal(r.state.ownerSession, null);
});

test("P7：session 不明(demo/manual)の TODO はクエストを更新するがオーナーは変えない（ロック中でも）", () => {
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業"));
  r = reduceHookEvent(r.state, todoBy("A", [{ content: "A task", status: "in_progress" }])); // owner A, ロック中
  assert.equal(r.state.ownerSession, "A");
  // session 不明の手動 TodoWrite（demo）→ permissive にクエスト更新するが owner は奪わない。
  r = reduceHookEvent(r.state, todoWrite([{ content: "demo task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "A", "null session はオーナーを奪わない（P7）");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["demo task"], "null session でもクエストは更新（permissive）");
});

test("ターン終了は漏れた subagentCounts ロックも解放する（安全弁）", () => {
  let r = reduceHookEvent(createInitialState(), promptBy("A", "親の作業")); // owner A, synthetic
  r = reduceHookEvent(r.state, subStartBy("A"));
  r = reduceHookEvent(r.state, subStartBy("A")); // count A = 2
  r = reduceHookEvent(r.state, subStopBy("A")); // count A = 1（2 start / 1 stop ＝取りこぼし相当）
  assert.equal(r.state.subagentCounts.A, 1);

  // 漏れた稼働カウントでロックが残る＝B の TODO は奪取不可。
  r = reduceHookEvent(r.state, planBy("B", [{ step: "B task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "A", "漏れた稼働カウントでロックが残る");

  // オーナーの Stop（ターン終了）で漏れたロックも必ず解放（安全弁）。
  r = reduceHookEvent(r.state, stopBy("A"));
  assert.deepEqual(r.state.subagentCounts, {}, "ターン終了で稼働カウンタをクリア");
  assert.equal(r.state.ownerSession, null, "ターン終了でオーナー解放");
});

test("TODO（session付き）が最初のオーナー確定イベントになれる", () => {
  // 誰も UserPromptSubmit していない（owner null）状態から、X の update_plan がオーナーを確定。
  let r = reduceHookEvent(createInitialState(), planBy("X", [{ step: "X task", status: "in_progress" }]));
  assert.equal(r.state.ownerSession, "X", "owner 未確定なら TODO でオーナー確定");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["X task"]);
});

test("owner session resets on SessionStart so a fresh session can own the quest", () => {
  let r = reduceHookEvent(createInitialState(), {
    provider: "claude",
    event: "UserPromptSubmit",
    raw: { session_id: "A", prompt: "old" }
  });
  assert.equal(r.state.ownerSession, "A");
  r = reduceHookEvent(r.state, { provider: "claude", event: "SessionStart", raw: {} });
  assert.equal(r.state.ownerSession, null, "SessionStart でオーナーをリセット");
  r = reduceHookEvent(r.state, {
    provider: "claude",
    event: "UserPromptSubmit",
    raw: { session_id: "C", prompt: "new" }
  });
  assert.equal(r.state.ownerSession, "C", "新セッションが新オーナー");
  assert.deepEqual(r.state.quest.map((q) => q.label), ["new"]);
});

// --- 要件4: 精霊のライフ(5) と被弾退場（CounterHit はサーバー権威）---

test("summoned spirits start with life = 5 (SubagentStart and battle reinforcement)", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(r.state.allies.length, 1);
  assert.equal(r.state.allies[0].life, 5, "SubagentStart 召喚の精霊は life=5");
  assert.ok(r.state.allies[0].damagedSprite, "life<=2 表示用の damaged sprite 名を持つ");

  __setChance(chanceSeq(0, 0)); // 出現
  let s = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  s = reduceHookEvent(s.state, pre()); // 出現(linked)
  __setChance(() => 0); // 増援
  s = reduceHookEvent(s.state, pre());
  assert.ok(s.state.allies.length >= 1);
  assert.ok(s.state.allies.every((a) => a.life === 5), "戦闘増援の精霊も life=5");
  assert.ok(s.state.allies.every((a) => a.damagedSprite), "戦闘増援の精霊も damaged sprite 名を持つ");
});

test("CounterHit effects inherit the current monster counter effect", () => {
  let r = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "task 1", status: "completed" },
      { content: "task 2", status: "completed" },
      { content: "task 3", status: "in_progress" }
    ])
  );
  __setChance(chanceSeq(0, 0.34)); // castle without boss unlock => dark-mage, counterEffect=magic
  r = reduceHookEvent(r.state, pre());
  assert.equal(r.state.monsters[0].sprite, "dark-mage");
  assert.equal(r.state.monsters[0].counterEffect, "magic");
  __setChance(() => 0);
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  const allyId = r.state.allies[0].id;
  r = reduceHookEvent(r.state, { event: "CounterHit", allyId, raw: {} });
  const hit = r.effects.find((e) => e.type === "ally_hit");
  assert.equal(hit.counterEffect, "magic");
  assert.equal(hit.monsterId, r.state.monsters[0].id);
});

test("a spirit vanishes after 5 counter hits; earlier hits only decrement its life", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  const allyId = r.state.allies[0].id;
  for (let i = 0; i < 4; i += 1) {
    r = reduceHookEvent(r.state, { event: "CounterHit", allyId, raw: {} });
  }
  assert.equal(r.state.allies.length, 1, "4被弾では在席");
  assert.equal(r.state.allies[0].life, 1);
  assert.ok(r.effects.some((e) => e.type === "ally_hit" && e.allyId === allyId && e.life === 1));
  r = reduceHookEvent(r.state, { event: "CounterHit", allyId, raw: {} });
  assert.equal(r.state.allies.length, 0, "5被弾で退場");
  assert.ok(r.effects.some((e) => e.type === "ally_defeated" && e.allyId === allyId && e.reason === "depleted"));
});

test("a counter hit only affects the targeted spirit, not the others", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(r.state.allies.length, 2);
  const [a0, a1] = r.state.allies.map((a) => a.id);
  r = reduceHookEvent(r.state, { event: "CounterHit", allyId: a0, raw: {} });
  assert.equal(r.state.allies.find((a) => a.id === a0).life, 4, "対象は減る");
  assert.equal(r.state.allies.find((a) => a.id === a1).life, 5, "非対象は不変");
});

test("CounterHit on an unknown/already-gone ally is a silent no-op (no effect, no resurrect)", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  const before = r.state.allies.length;
  r = reduceHookEvent(r.state, { event: "CounterHit", allyId: "ally-does-not-exist", raw: {} });
  assert.equal(r.state.allies.length, before, "不在 ally への CounterHit は何もしない");
  assert.ok(!r.effects.some((e) => e.type === "ally_hit" || e.type === "ally_defeated"), "effect も出さない");
});

test("a legacy spirit with no life field is treated as full life on CounterHit", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  delete r.state.allies[0].life; // 旧 state を模す
  const allyId = r.state.allies[0].id;
  r = reduceHookEvent(r.state, { event: "CounterHit", allyId, raw: {} });
  assert.equal(r.state.allies[0].life, 4, "life 無し精霊は満タン(5)扱いで減算→4");
});

test("monster defeat removes spirits via ally_return regardless of remaining life (not ally_defeated)", () => {
  __setChance(chanceSeq(0, 0));
  let r = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  r = reduceHookEvent(r.state, pre()); // linked 出現
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  const allyId = r.state.allies[0].id;
  r = reduceHookEvent(r.state, { event: "CounterHit", allyId, raw: {} }); // life=4 に削る
  assert.equal(r.state.allies[0].life, 4);
  __setChance(() => 0.99);
  r = reduceHookEvent(r.state, todoWrite([{ content: "task", status: "completed" }])); // 討伐
  assert.equal(r.state.monsters.length, 0);
  assert.equal(r.state.allies.length, 0);
  assert.ok(r.effects.some((e) => e.type === "ally_return" && e.allyId === allyId), "討伐時は ally_return で退場");
  assert.ok(!r.effects.some((e) => e.type === "ally_defeated"), "討伐時は被弾死(ally_defeated)ではない");
});
