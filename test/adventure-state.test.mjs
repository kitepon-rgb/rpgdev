import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, reduceHookEvent, detectFailure, normalizeHookEvent } from "../server/adventure-state.mjs";

// 設計の正典: docs/design-todo-rpg.md（TODO 項目＝モンスター モデル）

function todoWrite(todos) {
  return { provider: "claude", event: "PostToolUse", raw: { tool_name: "TodoWrite", tool_input: { todos } } };
}
function updatePlan(plan) {
  return { provider: "codex", event: "PostToolUse", raw: { tool_name: "update_plan", tool_input: { plan } } };
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

test("TodoWrite spawns monsters; in_progress becomes the battle", () => {
  const { state } = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "audit routes", status: "in_progress" },
      { content: "extract handlers", status: "pending" },
      { content: "add tests", status: "pending" }
    ])
  );
  assert.equal(state.monsters.length, 3);
  assert.equal(state.phase, "battle");
  const engaged = state.monsters.find((m) => m.status === "in_progress");
  assert.equal(engaged.label, "audit routes");
});

test("Codex update_plan drives the same model (provider parity)", () => {
  const { state } = reduceHookEvent(
    createInitialState(),
    updatePlan([
      { step: "audit routes", status: "completed" },
      { step: "extract handlers", status: "in_progress" },
      { step: "add tests", status: "pending" }
    ])
  );
  // completed 項目はトドメ済みとして名簿に残らない
  assert.equal(state.monsters.length, 2);
  assert.equal(state.defeatedCount, 0); // 初出の completed はスポーン前なので撃破カウントはしない
  assert.equal(state.monsters.find((m) => m.status === "in_progress").label, "extract handlers");
});

test("completing a TODO item is the finishing blow even with HP remaining", () => {
  let result = reduceHookEvent(createInitialState(), todoWrite([{ content: "ship feature", status: "in_progress" }]));
  const monster = result.state.monsters[0];
  assert.equal(monster.hp, monster.maxHp); // 攻撃前、満タン

  result = reduceHookEvent(result.state, todoWrite([{ content: "ship feature", status: "completed" }]));
  assert.equal(result.state.monsters.length, 0);
  assert.equal(result.state.defeatedCount, 1);
  const finisher = result.effects.find((e) => e.type === "monster_defeated");
  assert.equal(finisher.finisher, true);
});

test("HP cannot kill: attacks floor the monster into a dying state, only completion kills", () => {
  let result = reduceHookEvent(createInitialState(), todoWrite([{ content: "hard task", status: "in_progress" }]));

  let guard = 0;
  while (!result.state.monsters[0].dying && guard < 100) {
    result = reduceHookEvent(result.state, { provider: "claude", event: "PostToolUse", raw: { tool_name: "Edit" } });
    guard += 1;
  }
  const monster = result.state.monsters[0];
  assert.equal(monster.dying, true);
  assert.ok(monster.hp >= 1, "HP は最低でも 1 で張り付く（殺せない）");
  assert.equal(result.state.monsters.length, 1, "瀕死でも撃破されない");

  // さらに殴っても倒れない（ヨーヨーせず stagger）
  const more = reduceHookEvent(result.state, { provider: "claude", event: "PostToolUse", raw: { tool_name: "Bash" } });
  assert.equal(more.state.monsters.length, 1);
  assert.ok(more.effects.some((e) => e.type === "attack" && e.stagger === true));

  // completed で初めて撃破
  const done = reduceHookEvent(more.state, todoWrite([{ content: "hard task", status: "completed" }]));
  assert.equal(done.state.monsters.length, 0);
  assert.equal(done.state.defeatedCount, 1);
});

test("PreToolUse = normal attack, PostToolUse = skill attack named after the tool", () => {
  let result = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));

  result = reduceHookEvent(result.state, { provider: "claude", event: "PreToolUse", raw: { tool_name: "Grep" } });
  const normal = result.effects.find((e) => e.type === "attack");
  assert.equal(normal.kind, "normal");

  result = reduceHookEvent(result.state, { provider: "claude", event: "PostToolUse", raw: { tool_name: "Edit" } });
  const skill = result.effects.find((e) => e.type === "attack");
  assert.equal(skill.kind, "skill");
  assert.equal(skill.skill, "Edit");
});

test("Claude failure (PostToolUseFailure event) triggers a counterattack, not a spawn", () => {
  let result = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  result = reduceHookEvent(result.state, {
    provider: "claude",
    event: "PostToolUseFailure",
    raw: { tool_name: "Bash", tool_input: { command: "npm test" } }
  });
  assert.equal(result.state.monsters.length, 1, "失敗で新モンスターは湧かない");
  assert.ok(result.effects.some((e) => e.type === "counter"));
});

test("a PostToolUse payload that carries a structured non-zero exit code triggers a counterattack", () => {
  // exit code を構造化フィールドで持つ payload（manual/合成、または将来そうなった場合）にのみ効く。
  let result = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  result = reduceHookEvent(result.state, {
    provider: "manual",
    event: "PostToolUse",
    raw: { tool_name: "Bash", tool_input: { command: "npm test" }, tool_response: { exit_code: 1 } }
  });
  assert.ok(result.effects.some((e) => e.type === "counter"));
});

test("REAL Codex failure payloads carry no outcome, so failure is NOT detected (verified limitation, docs §7.2)", () => {
  // 実機検証: Codex の PostToolUse は tool_response が出力文字列のみ。exit_code も status も無い。
  // exit 7 でも tool_response は "BYE\n"。成功と失敗が区別できない＝検知不能。
  const codexFail = normalizeHookEvent({
    provider: "codex",
    event: "PostToolUse",
    raw: { tool_name: "Bash", tool_input: { command: "sh -c 'echo BYE; exit 7'" }, tool_response: "BYE\n" }
  });
  assert.equal(detectFailure(codexFail), false);

  let result = reduceHookEvent(createInitialState(), updatePlan([{ step: "task", status: "in_progress" }]));
  result = reduceHookEvent(result.state, {
    provider: "codex",
    event: "PostToolUse",
    raw: { tool_name: "Bash", tool_input: { command: "sh -c 'echo BYE; exit 7'" }, tool_response: "BYE\n" }
  });
  // 失敗を検知できないので counter ではなく skill 攻撃（成功扱い）になる
  assert.ok(result.effects.some((e) => e.type === "attack" && e.kind === "skill"));
  assert.ok(!result.effects.some((e) => e.type === "counter"));
});

test("benign output containing the word 'error' is NOT a failure (false-positive fix)", () => {
  // 旧 detectFailure の単語マッチ廃止。exit 0 の成功は failure 扱いしない。
  const event = normalizeHookEvent({
    provider: "claude",
    event: "PostToolUse",
    raw: { tool_name: "Read", tool_response: { exit_code: 0, content: "Error handling is documented in errors.md" } }
  });
  assert.equal(detectFailure(event), false);

  const result = reduceHookEvent(
    reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }])).state,
    {
      provider: "claude",
      event: "PostToolUse",
      raw: { tool_name: "Read", tool_response: { exit_code: 0, content: "Error: this is just file text" } }
    }
  );
  // counter ではなく skill 攻撃になる
  assert.ok(result.effects.some((e) => e.type === "attack" && e.kind === "skill"));
  assert.ok(!result.effects.some((e) => e.type === "counter"));
});

test("Stop completes only when no monsters remain", () => {
  let result = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));

  let blocked = reduceHookEvent(result.state, { provider: "claude", event: "Stop", raw: {} });
  assert.equal(blocked.state.phase, "battle");
  assert.ok(blocked.effects.some((e) => e.type === "turn_blocked"));

  const cleared = reduceHookEvent(
    reduceHookEvent(result.state, todoWrite([{ content: "task", status: "completed" }])).state,
    { provider: "claude", event: "Stop", raw: {} }
  );
  assert.equal(cleared.state.active, false);
  assert.equal(cleared.state.phase, "complete");
});

test("an item removed from the plan (not completed) makes the monster flee", () => {
  let result = reduceHookEvent(
    createInitialState(),
    todoWrite([
      { content: "keep", status: "in_progress" },
      { content: "drop", status: "pending" }
    ])
  );
  assert.equal(result.state.monsters.length, 2);

  result = reduceHookEvent(result.state, todoWrite([{ content: "keep", status: "in_progress" }]));
  assert.equal(result.state.monsters.length, 1);
  assert.ok(result.effects.some((e) => e.type === "monster_fled"));
});

test("in_progress -> pending makes the monster retreat (back to exploration)", () => {
  let result = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  assert.equal(result.state.phase, "battle");

  result = reduceHookEvent(result.state, todoWrite([{ content: "task", status: "pending" }]));
  assert.equal(result.state.phase, "field");
  assert.ok(result.effects.some((e) => e.type === "retreat"));
});

test("no-TODO session stays in peaceful exploration and completes, never entering battle (docs §2 policy = accept)", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  assert.equal(r.state.phase, "field");
  r = reduceHookEvent(r.state, { provider: "claude", event: "PreToolUse", raw: { tool_name: "Read" } });
  r = reduceHookEvent(r.state, { provider: "claude", event: "PostToolUse", raw: { tool_name: "Read" } });
  assert.equal(r.state.monsters.length, 0);
  assert.equal(r.state.phase, "field"); // 戦闘にならず探検のまま
  assert.ok(r.effects.some((e) => e.type === "step"));
  r = reduceHookEvent(r.state, { provider: "claude", event: "Stop", raw: {} });
  assert.equal(r.state.phase, "complete");
  assert.equal(r.state.active, false);
});

test("SubagentStart summons an ally; SubagentStop returns it (LIFO), and a spurious Stop is silent", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(r.state.allies.length, 1);
  assert.ok(r.effects.some((e) => e.type === "ally_summon" && e.ally));
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(r.state.allies.length, 2);
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStop", raw: {} });
  assert.equal(r.state.allies.length, 1);
  assert.ok(r.effects.some((e) => e.type === "ally_return"));
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStop", raw: {} });
  assert.equal(r.state.allies.length, 0);
  // 仲間ゼロで SubagentStop が来ても黙って成功扱いにしない（effect を出さない）
  const extra = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStop", raw: {} });
  assert.ok(!extra.effects.some((e) => e.type === "ally_return"));
});

test("present allies assist the hero's attack on the current monster (extra cosmetic damage)", () => {
  const base = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }])).state;
  const beforeHp = base.monsters[0].hp;

  const solo = reduceHookEvent(base, { provider: "claude", event: "PreToolUse", raw: { tool_name: "Read" } });
  const soloDrop = beforeHp - solo.state.monsters[0].hp;

  const withAlly = reduceHookEvent(base, { provider: "claude", event: "SubagentStart", raw: {} });
  const hpAfterSummon = withAlly.state.monsters[0].hp;
  const assisted = reduceHookEvent(withAlly.state, { provider: "claude", event: "PreToolUse", raw: { tool_name: "Read" } });
  const assistedDrop = hpAfterSummon - assisted.state.monsters[0].hp;

  assert.equal(hpAfterSummon, beforeHp, "召喚自体は攻撃しない");
  assert.ok(assistedDrop > soloDrop, "仲間がいる方が多く削れる");
  assert.ok(assisted.effects.some((e) => e.type === "attack" && e.kind === "ally"));
});

test("allies cannot kill: only TODO completion defeats the monster", () => {
  let r = reduceHookEvent(createInitialState(), todoWrite([{ content: "task", status: "in_progress" }]));
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  let guard = 0;
  while (!r.state.monsters[0].dying && guard < 200) {
    r = reduceHookEvent(r.state, { provider: "claude", event: "PostToolUse", raw: { tool_name: "Edit" } });
    guard += 1;
  }
  assert.equal(r.state.monsters.length, 1, "仲間がいても HP では撃破されない");
  assert.ok(r.state.monsters[0].hp >= 1);
  const done = reduceHookEvent(r.state, todoWrite([{ content: "task", status: "completed" }]));
  assert.equal(done.state.monsters.length, 0);
  assert.equal(done.state.defeatedCount, 1);
});

test("allies do not attack when there is no current monster (exploration)", () => {
  let r = reduceHookEvent(createInitialState(), { provider: "claude", event: "UserPromptSubmit", raw: {} });
  r = reduceHookEvent(r.state, { provider: "claude", event: "SubagentStart", raw: {} });
  assert.equal(r.state.phase, "field"); // 敵なし＝探検
  r = reduceHookEvent(r.state, { provider: "claude", event: "PreToolUse", raw: { tool_name: "Read" } });
  assert.ok(r.effects.some((e) => e.type === "step"));
  assert.ok(!r.effects.some((e) => e.type === "attack"));
});
