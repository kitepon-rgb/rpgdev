import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  reduceHookEvent,
  detectFailure,
  normalizeHookEvent,
  __setChance
} from "../server/adventure-state.mjs";

// 設計: ランダムエンカウント モデル。
// モンスターはツール使用時に確率で出現するエンカウント。TODO（クエスト）は表示用一覧＋討伐条件。

// 既定ではゲーム乱数（出現・増援）を無効化して決定的にする。
// 乱数挙動を検証するテストだけ __setChance(...) で上書きする（id 生成は Math.random のまま＝一意）。
beforeEach(() => __setChance(() => 0.99));
afterEach(() => __setChance(null));

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

test("a no-TODO encounter is defeated after 5 hero attacks", () => {
  __setChance(chanceSeq(0, 0)); // 出現(gate0,select0)。以降0.99で増援なし・追加出現なし
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, pre()); // 出現だけ（1 Hook 1 アクション＝攻撃しない）
  assert.equal(r.state.monsters.length, 1);
  assert.equal(r.state.monsters[0].linkedTodo, false);
  assert.equal(r.state.monsters[0].hits, 0, "出現の Hook では攻撃しない");
  // 以降は攻撃のみ（chanceSeq 使い切りで 0.99 ＝増援なし）。1〜4撃目
  r = reduceHookEvent(r.state, post()); // hits=1
  r = reduceHookEvent(r.state, pre()); // hits=2
  r = reduceHookEvent(r.state, post()); // hits=3
  r = reduceHookEvent(r.state, pre()); // hits=4
  assert.equal(r.state.monsters.length, 1, "4撃ではまだ生存");
  r = reduceHookEvent(r.state, post()); // hits=5 → 討伐
  assert.equal(r.state.monsters.length, 0, "hero の攻撃5回で討伐");
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

test("PreToolUse = normal attack, PostToolUse = skill attack named after the tool (against the encounter)", () => {
  __setChance(chanceSeq(0, 0)); // 最初の Pre で出現させる（出現のみ）
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, pre()); // 出現
  assert.equal(r.state.monsters.length, 1);
  __setChance(() => 0.99); // 以降は増援なし＝攻撃になる
  let res = reduceHookEvent(r.state, pre("Grep")); // 通常攻撃
  const normal = res.effects.find((e) => e.type === "attack");
  assert.equal(normal.kind, "normal");
  res = reduceHookEvent(res.state, post("Edit")); // スキル攻撃
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

  // 戦闘中、攻撃が起きる Hook は召喚しない
  __setChance(() => 0.99);
  const attackR = reduceHookEvent(r.state, pre());
  assert.ok(attackR.effects.some((e) => e.type === "attack"));
  assert.ok(!attackR.effects.some((e) => e.type === "ally_summon"), "攻撃と召喚は同時に起きない");
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

test("present spirits assist only PostToolUse attacks on the encounter", () => {
  __setChance(chanceSeq(0, 0)); // linked エンカウントを1体出す（攻撃で倒れない＝HP 比較できる）
  let base = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }])).state;
  base = reduceHookEvent(base, pre()).state; // 出現(linked) + 1撃（chanceSeq 消費）
  __setChance(() => 0.99); // 以降 増援/出現なし
  const hp0 = base.monsters[0].hp;

  const solo = reduceHookEvent(base, post("Read"));
  const soloDrop = hp0 - solo.state.monsters[0].hp;

  const withAlly = reduceHookEvent(base, { provider: "claude", event: "SubagentStart", raw: {} });
  const hp1 = withAlly.state.monsters[0].hp;
  const preAttack = reduceHookEvent(withAlly.state, pre("Read"));
  assert.ok(!preAttack.effects.some((e) => e.type === "attack" && e.kind === "ally"));

  const assisted = reduceHookEvent(withAlly.state, post("Read"));
  const assistedDrop = hp1 - assisted.state.monsters[0].hp;

  assert.equal(hp1, hp0, "召喚自体は攻撃しない");
  assert.ok(assistedDrop > soloDrop, "精霊がいる方が多く削れる");
  const allyAttack = assisted.effects.find((e) => e.type === "attack" && e.kind === "ally");
  assert.ok(allyAttack);
  assert.equal(allyAttack.allyElement, withAlly.state.allies[0].element);
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

test("spirits do not attack when there is no encounter (exploration)", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(r.state.phase, "field");
  r = reduceHookEvent(r.state, pre());
  assert.ok(r.effects.some((e) => e.type === "step"));
  assert.ok(!r.effects.some((e) => e.type === "attack"), "敵不在では攻撃は起きない");
  assert.ok(!r.effects.some((e) => e.type === "ally_summon"), "敵不在では増援召喚も起きない");
});
