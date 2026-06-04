#!/usr/bin/env node
const BASE_URL = `http://${process.env.RPGDEV_HOST || "127.0.0.1"}:${process.env.RPGDEV_PORT || 37373}`;

const events = [
  ["manual", "UserPromptSubmit", { prompt: "demo adventure" }],
  ["manual", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } }],
  [
    "manual",
    "PostToolUse",
    {
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 1, stderr: "Error: expected true to be false" }
    }
  ],
  ["manual", "PreToolUse", { tool_name: "Edit", tool_input: { file_path: "src/app.ts" } }],
  ["manual", "PostToolUse", { tool_name: "Edit", tool_response: { success: true } }],
  ["manual", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } }],
  ["manual", "PostToolUse", { tool_name: "Bash", tool_response: { exit_code: 0, stdout: "pass" } }],
  ["manual", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm run build" } }],
  ["manual", "PostToolUse", { tool_name: "Bash", tool_response: { exit_code: 0, stdout: "built" } }],
  ["manual", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test -- --runInBand" } }],
  ["manual", "PostToolUse", { tool_name: "Bash", tool_response: { exit_code: 0, stdout: "all green" } }],
  ["manual", "Stop", { reason: "demo complete" }]
];

for (const [provider, event, raw] of events) {
  await fetch(`${BASE_URL}/hook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, event, raw, at: new Date().toISOString() })
  });
  await delay(900);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
