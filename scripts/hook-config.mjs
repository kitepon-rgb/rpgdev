// RPGDev フック設定ビルダー（純関数のみ・I/O なし）。
// `rpgdev setup` がこれを使って「正しいフック設定」を組み立てる。設定ファイルへの
// 適用（マージ・書込）は rpgdev では行わず、利用者のエージェントが docs/install-hooks.md の
// 安全規則に従って実施する。ここはその“正解”を生成する唯一のテスト対象。

// Claude/Codex 両スキーマが無視する安定マーカー。エージェントが「既に入っている rpgdev フック」を
// 同定して重複追加を避ける／パスだけ更新するための目印。
export const RPGDEV_MARKER = "rpgdev";

// プロバイダ別の検証済みイベント表（既存 examples を踏襲）。
// matcher: "*" を付けるイベントと付けないイベントがある。timeout/statusMessage も既存例と同一。
const CLAUDE_EVENTS = [
  { event: "UserPromptSubmit", matcher: null, timeout: 5, statusMessage: "冒険の小窓を開いています" },
  { event: "PreToolUse", matcher: "*", timeout: 3, statusMessage: "小窓の冒険が進んでいます" },
  { event: "PostToolUse", matcher: "*", timeout: 3, statusMessage: "戦況を更新しています" },
  { event: "PostToolUseFailure", matcher: "*", timeout: 3, statusMessage: "モンスターが出現しています" },
  { event: "PermissionDenied", matcher: "*", timeout: 3, statusMessage: "障害を記録しています" },
  { event: "Stop", matcher: null, timeout: 3, statusMessage: "冒険を記録しています" },
  { event: "StopFailure", matcher: "*", timeout: 3, statusMessage: "冒険の危機を記録しています" },
  { event: "SubagentStart", matcher: null, timeout: 3, statusMessage: "仲間が駆けつけています" },
  { event: "SubagentStop", matcher: null, timeout: 3, statusMessage: "仲間が去っていきます" }
];

// Codex は失敗を payload で報告できない（design-todo-rpg §7-§8 で実機検証済み）ため失敗系イベントを持たない。
const CODEX_EVENTS = [
  { event: "UserPromptSubmit", matcher: null, timeout: 5, statusMessage: "冒険の小窓を開いています" },
  { event: "PreToolUse", matcher: "*", timeout: 3, statusMessage: "小窓の冒険が進んでいます" },
  { event: "PostToolUse", matcher: "*", timeout: 3, statusMessage: "戦況を更新しています" },
  { event: "Stop", matcher: null, timeout: 3, statusMessage: "冒険を記録しています" },
  { event: "SubagentStart", matcher: null, timeout: 3, statusMessage: "仲間が駆けつけています" },
  { event: "SubagentStop", matcher: null, timeout: 3, statusMessage: "仲間が去っていきます" }
];

export const EVENT_SETS = { claude: CLAUDE_EVENTS, codex: CODEX_EVENTS };

// Codex のインライン文字列用にパスを二重引用（空白を含むパス対策）。内部の " はエスケープ。
export function quoteArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

// 1 イベント分のフックエントリを作る。
// Claude: exec 形式（command=node 実体, args=[script, "claude", event]）。シェル非経由なので空白パスでも安全。
// Codex: インライン文字列（command="\"node\" \"script\" codex event"）。シェル経由のため引用が要る。
function makeEntry(provider, event, nodeBin, hookScriptAbs, timeout, statusMessage, opts) {
  if (provider === "claude") {
    return {
      type: "command",
      command: nodeBin,
      args: [hookScriptAbs, "claude", event],
      timeout,
      statusMessage,
      _rpgdev: RPGDEV_MARKER
    };
  }

  let command = `${quoteArg(nodeBin)} ${quoteArg(hookScriptAbs)} codex ${event}`;
  if (opts.codexCmdWrap && opts.platform === "win32") {
    command = `cmd /c ${command}`;
  }
  return {
    type: "command",
    command,
    timeout,
    statusMessage,
    _rpgdev: RPGDEV_MARKER
  };
}

// プロバイダ1つぶんの完全な hooks ブロックを生成する。
// nodeBin/hookScriptAbs は呼び出し側が絶対パスで渡す（rpg-setup.mjs が process.execPath と
// パッケージルートから解決する）。process には触れない＝同入力→同出力の純関数。
export function buildHookConfig(provider, nodeBin, hookScriptAbs, opts = {}) {
  const events = EVENT_SETS[provider];
  if (!events) throw new Error(`Unknown provider: ${provider}`);

  const hooks = {};
  for (const { event, matcher, timeout, statusMessage } of events) {
    const entry = makeEntry(provider, event, nodeBin, hookScriptAbs, timeout, statusMessage, opts);
    const wrapper = matcher ? { matcher, hooks: [entry] } : { hooks: [entry] };
    hooks[event] = [wrapper];
  }
  return { hooks };
}
