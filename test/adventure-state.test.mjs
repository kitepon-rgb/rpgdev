import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, reduceHookEvent } from "../server/adventure-state.mjs";

test("starts an adventure from user prompt", () => {
  const { state, effects } = reduceHookEvent(createInitialState(), {
    provider: "manual",
    event: "UserPromptSubmit",
    raw: { prompt: "fix the test" }
  });

  assert.equal(state.active, true);
  assert.equal(state.phase, "field");
  assert.equal(state.currentTrack, "adventure");
  assert.equal(state.turn, 1);
  assert.equal(effects[0].type, "adventure_started");
});

test("spawns a monster when a tool result fails", () => {
  let result = reduceHookEvent(createInitialState(), {
    provider: "manual",
    event: "UserPromptSubmit",
    raw: {}
  });

  result = reduceHookEvent(result.state, {
    provider: "manual",
    event: "PostToolUse",
    raw: {
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 1, stderr: "Error: broken assertion" }
    }
  });

  assert.equal(result.state.phase, "battle");
  assert.equal(result.state.currentTrack, "battle");
  assert.equal(result.state.monsters.length, 1);
  assert.equal(result.effects[0].type, "monster_appeared");
});

test("successful steps damage and defeat monsters", () => {
  let result = reduceHookEvent(createInitialState(), {
    provider: "manual",
    event: "PostToolUseFailure",
    raw: { tool_name: "Bash", tool_input: { command: "npm run build" } }
  });

  let guard = 0;
  while (result.state.monsters.length > 0 && guard < 20) {
    result = reduceHookEvent(result.state, {
      provider: "manual",
      event: "PostToolUse",
      raw: { tool_name: "Bash", tool_response: { exit_code: 0 } }
    });
    guard += 1;
  }

  assert.equal(result.state.monsters.length, 0);
  assert.equal(result.state.phase, "field");
  assert.equal(result.state.currentTrack, "adventure");
  assert.equal(result.state.errorsDefeated, 1);
});

test("turn completes only when no monsters remain", () => {
  let result = reduceHookEvent(createInitialState(), {
    provider: "manual",
    event: "UserPromptSubmit",
    raw: {}
  });

  result = reduceHookEvent(result.state, { provider: "manual", event: "Stop", raw: {} });

  assert.equal(result.state.active, false);
  assert.equal(result.state.phase, "complete");
  assert.equal(result.state.currentTrack, "field");
});

test("late tool events start a clean new turn after completion", () => {
  let result = reduceHookEvent(createInitialState(), {
    provider: "manual",
    event: "UserPromptSubmit",
    raw: {}
  });
  result = reduceHookEvent(result.state, { provider: "manual", event: "Stop", raw: {} });
  result = reduceHookEvent(result.state, {
    provider: "manual",
    event: "PostToolUse",
    raw: { tool_name: "Bash", tool_response: { exit_code: 0 } }
  });

  assert.equal(result.state.turn, 2);
  assert.equal(result.state.progress, 7);
  assert.equal(result.state.steps, 1);
  assert.equal(result.state.phase, "field");
});
