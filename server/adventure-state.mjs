// ランダムエンカウント モデル。
// モンスターは TODO 由来ではなく、ツール使用時に確率で出現する「エンカウント」。
// TODO（クエスト）は表示用の一覧であり、進行中 TODO の完了が「紐づくエンカウント」の討伐条件になる。
// この reducer は純粋関数（I/O なし）: reduceHookEvent(prev, event) -> { state, effects, normalized }。

const MONSTER_CATALOG = [
  { name: "Slime", element: "syntax", sprite: "slime", hp: 72 },
  { name: "Goblin", element: "runtime", sprite: "goblin", hp: 96 },
  { name: "Orc", element: "build", sprite: "orc", hp: 124 },
  { name: "Ogre", element: "logic", sprite: "ogre", hp: 156 }
];

const MAX_LOG = 80;
const NORMAL_DAMAGE = 8; // PreToolUse 通常攻撃（演出用の HP 減少量）
const SKILL_DAMAGE = 18; // PostToolUse スキル攻撃（演出用の HP 減少量）

// ランダムエンカウント＆増援
const ENCOUNTER_SPAWN_CHANCE = 0.2; // ツール使用(PreToolUse)毎にモンスターが出現する確率（TODO 有無に関わらず統一）
const WILD_HITS_TO_DEFEAT = 5; // TODO 不在で出たエンカウントは hero の攻撃 N 回で討伐（HP は無関係）
const BATTLE_SUMMON_CHANCE = 0.1; // 戦闘中、ツール使用(PreToolUse)毎に精霊が1体だけ増援する確率
const MAX_ALLIES = 4; // 精霊の同時在席上限（表示枠・属性数＝4）

// ゲーム確率の判定に使う乱数。テストから差し替え可能（id 生成の Math.random とは分離）。
let chance = Math.random;
export function __setChance(fn) {
  chance = typeof fn === "function" ? fn : Math.random;
}

// プロバイダ別 TODO ツール（docs §6 / §7 で実機確認済み）。
const TODO_TOOLS = {
  TodoWrite: "todos", // Claude（実機検証済み）
  update_plan: "plan" // Codex（実機検証済み）
};

const QUEST_STAGES = ["field", "dungeon", "castle"];

export function createInitialState() {
  return {
    active: false,
    phase: "idle", // idle | field | battle | complete
    turn: 0,
    currentTrack: "field", // field | adventure | battle | dungeon-adventure | dungeon-battle | castle-adventure | castle-battle
    adventureStage: "field", // field | dungeon | castle
    monsters: [], // 出現中のエンカウント（同時に最大1体）
    defeated: [],
    quest: [], // 最新 TodoWrite スナップショット（元の順序・status 付き）= クエスト一覧の表示用
    allies: [], // 在席中の精霊（攻撃時に増援 / SubagentStart でも参戦）
    steps: 0,
    attacks: 0,
    spawned: 0,
    defeatedCount: 0,
    lastEvent: null,
    log: []
  };
}

const ALLY_CATALOG = [
  { name: "Ignis", sprite: "ally-fire", element: "fire" },
  { name: "Terra", sprite: "ally-earth", element: "earth" },
  { name: "Sylph", sprite: "ally-wind", element: "wind" },
  { name: "Aqua", sprite: "ally-water-facing-slit", element: "water" }
];
const ALLY_DAMAGE = 6; // 精霊アシストの1撃（演出。討伐ヒット数には数えない）

export function reduceHookEvent(previousState, hookEvent) {
  const state = cloneState(previousState);
  // 旧/部分的な state.json を読んでもクラッシュしないよう配列を正規化（無い場合のみ）。
  if (!Array.isArray(state.monsters)) state.monsters = [];
  if (!Array.isArray(state.defeated)) state.defeated = [];
  if (!Array.isArray(state.allies)) state.allies = [];
  if (!Array.isArray(state.quest)) state.quest = [];
  if (!QUEST_STAGES.includes(state.adventureStage)) state.adventureStage = "field";
  const event = normalizeHookEvent(hookEvent);
  const effects = [];

  state.lastEvent = event;

  switch (event.event) {
    case "SessionStart":
      townReset(state, event, effects);
      break;
    case "UserPromptSubmit":
      beginTurn(state, event, effects);
      break;
    case "PreToolUse":
      normalAttack(state, event, effects);
      break;
    case "PermissionRequest":
      hold(state, event, effects);
      break;
    case "PostToolUse":
      if (event.todoItems) {
        reconcileQuest(state, event, effects);
      } else if (detectFailure(event)) {
        counter(state, event, effects);
      } else {
        skillAttack(state, event, effects);
      }
      break;
    case "PostToolUseFailure":
    case "StopFailure":
    case "PermissionDenied":
      counter(state, event, effects);
      break;
    case "SubagentStart":
      summonAlly(state, event, effects);
      break;
    case "SubagentStop":
      returnAlly(state, event, effects);
      break;
    case "PreCompact":
      ambient(state, event, effects, "compact_pre");
      break;
    case "PostCompact":
      ambient(state, event, effects, "compact_post");
      break;
    case "Stop":
    case "SessionEnd":
      finishTurn(state, event, effects);
      break;
    default:
      step(state, event, effects);
      break;
  }

  if (state.active) {
    state.phase = hasEngaged(state) ? "battle" : "field";
  }
  state.adventureStage = currentAdventureStage(state);
  state.currentTrack = trackForState(state);
  state.log = state.log.slice(-MAX_LOG);
  return { state, effects, normalized: event };
}

// --- クエスト（TODO 一覧。表示用＋紐づくエンカウントの討伐条件）---

function reconcileQuest(state, event, effects) {
  ensureActive(state, event, effects);

  const prevStatus = new Map((state.quest || []).map((q) => [q.label, q.status]));
  // 直前スナップショットと比べて新たに completed になった項目があるか。
  const newlyCompleted = event.todoItems.some(
    (it) => it.status === "completed" && prevStatus.get(it.label) !== "completed"
  );

  // クエスト一覧を最新スナップショットで更新（表示用）。モンスターは TODO からは湧かない。
  state.quest = assignQuestStages(event.todoItems);

  // TODO を1項目でも完了したら、それに紐づくエンカウントを討伐。
  if (newlyCompleted) {
    for (const monster of [...state.monsters]) {
      if (monster.linkedTodo) finishMonster(state, monster, event, effects);
    }
  }

  // 進行中の本物の TODO が無くなったら紐づきを解除（以後そのエンカウントは 5撃/ターン終了で討伐できる）。
  if (!hasRealTodoInProgress(state)) {
    for (const monster of state.monsters) monster.linkedTodo = false;
  }
}

// ツール使用毎に ENCOUNTER_SPAWN_CHANCE でモンスターが出現。同時に2体は出さない（表示は1体）。
// 出現時に進行中の TODO があれば linkedTodo=true（その TODO 完了で討伐）、無ければ 5撃/ターン終了で討伐。
function maybeSpawnEncounter(state, event, effects) {
  if (state.monsters.length > 0) return null; // 同時に2体出現はしない
  if (chance() >= ENCOUNTER_SPAWN_CHANCE) return null;
  const linkedTodo = hasRealTodoInProgress(state); // 合成クエスト(ユーザー入力)は紐づけ対象にしない
  const template = MONSTER_CATALOG[Math.floor(chance() * MONSTER_CATALOG.length)];
  const monster = {
    id: `monster-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: template.name,
    status: "in_progress",
    name: template.name,
    element: template.element,
    sprite: template.sprite,
    maxHp: template.hp,
    hp: template.hp,
    dying: false,
    wild: true,
    hits: 0,
    linkedTodo,
    appearedAt: event.at
  };
  state.monsters.push(monster);
  state.spawned += 1;
  pushLog(state, "monster_appeared", monster.label, event);
  effects.push({ type: "monster_appeared", monster });
  return monster;
}

function finishMonster(state, monster, event, effects) {
  removeMonster(state, monster);
  state.defeated.push({ ...monster, hp: 0, dying: false, defeatedAt: event.at });
  state.defeatedCount += 1;
  pushLog(state, "monster_defeated", monster.label, event);
  effects.push({ type: "monster_defeated", monsterId: monster.id, finisher: true });

  // モンスターを倒すたびに在席中の精霊は全員退場（戦闘終了で消滅）。
  for (const ally of state.allies) effects.push({ type: "ally_return", allyId: ally.id });
  state.allies = [];
}

function removeMonster(state, monster) {
  state.monsters = state.monsters.filter((m) => m.id !== monster.id);
}

// --- 攻撃 ---

function normalAttack(state, event, effects) {
  ensureActive(state, event, effects);
  state.steps += 1;
  // 1つの Hook では1アクションだけ：出現 / 召喚 / 攻撃 / 前進 のいずれか1つ。
  if (!currentTarget(state)) {
    // モンスター不在：出現判定。出たらそれが今回のアクション（攻撃はしない）、出なければ前進。
    if (maybeSpawnEncounter(state, event, effects)) return;
    step(state, event, effects);
    return;
  }
  // モンスター在：精霊召喚（10%）か 通常攻撃 の片方だけ。召喚できたら今回は攻撃しない。
  if (maybeSummonReinforcement(state, event, effects)) return;
  const target = currentTarget(state);
  damage(state, target, NORMAL_DAMAGE, "normal", "", event, effects);
}

function skillAttack(state, event, effects) {
  ensureActive(state, event, effects);
  state.attacks += 1;
  const target = currentTarget(state);
  const skill = event.summary || event.toolName || "技";
  if (target) {
    damage(state, target, SKILL_DAMAGE, "skill", skill, event, effects);
    if (state.monsters.includes(target)) allyAssist(state, target, event, effects);
  } else {
    step(state, event, effects);
  }
}

// 在席中の精霊が hero の攻撃に続けて現在の敵を追撃（演出。討伐ヒット数には数えない）。
function allyAssist(state, target, event, effects) {
  for (const ally of state.allies) {
    damage(state, target, ALLY_DAMAGE, "ally", ally.name, event, effects, ally);
  }
}

// 戦闘中、ツール使用毎に BATTLE_SUMMON_CHANCE で精霊が1体だけ増援（重複属性は避ける／上限 MAX_ALLIES）。
// 実際に1体召喚できたら true（＝今回の Hook のアクションは召喚）。確率を外した/上限などで召喚しなければ false。
function maybeSummonReinforcement(state, event, effects) {
  if (chance() >= BATTLE_SUMMON_CHANCE) return false;
  return summonAlly(state, event, effects);
}

function damage(state, monster, amount, kind, skill, event, effects, ally = null) {
  const allyId = ally ? ally.id : undefined;
  const allyElement = ally ? ally.element : undefined;
  const applied = Math.max(0, Math.min(amount, monster.hp));
  monster.hp = Math.max(0, monster.hp - amount); // HP は演出用
  effects.push({ type: "attack", kind, skill, monsterId: monster.id, amount: applied, allyId, allyElement });
  pushLog(state, "attack", `${skill || kind} -${applied}`, event);

  // 討伐条件: linkedTodo なら攻撃では倒れない（TODO 完了で討伐）。
  // 紐づき無しなら hero の攻撃 WILD_HITS_TO_DEFEAT 回で討伐（精霊の追撃は数えない）。
  if (!monster.linkedTodo) {
    if (!ally) monster.hits = (monster.hits || 0) + 1;
    if (monster.hits >= WILD_HITS_TO_DEFEAT) finishMonster(state, monster, event, effects);
  }
}

function counter(state, event, effects) {
  ensureActive(state, event, effects);
  const target = currentTarget(state);
  pushLog(state, "counter", event.toolName || event.summary, event);
  effects.push({ type: "counter", skill: event.toolName, monsterId: target ? target.id : null });
}

// --- フェーズ遷移 ---

function townReset(state, event, effects) {
  state.active = false;
  state.phase = "idle";
  // 新セッション開始時は前回のクエスト・敵・精霊を持ち越さない。
  state.quest = [];
  state.monsters = [];
  state.allies = [];
  state.adventureStage = "field";
  pushLog(state, "session_start", "拠点に到着", event);
  effects.push({ type: "session_start", track: "field" });
}

function beginTurn(state, event, effects) {
  state.active = true;
  state.turn += 1;
  // TODO がまだ無い間は、ユーザー入力を1つのクエストとして表示する（synthetic）。
  // TodoWrite/update_plan が来たら reconcileQuest が本物の TODO で置き換える。
  // synthetic は表示専用で、エンカウントの linkedTodo（討伐条件）には数えない。
  const prompt = userPromptText(event);
  if (prompt) state.quest = [{ label: prompt, status: "in_progress", synthetic: true, stage: "field" }];
  pushLog(state, "adventure_started", `Turn ${state.turn} started`, event);
  effects.push({ type: "adventure_started", track: "adventure", turn: state.turn });
}

function ensureActive(state, event, effects) {
  if (state.active) return;
  state.active = true;
  pushLog(state, "adventure_started", "冒険再開", event);
  effects.push({ type: "adventure_started", track: "adventure", turn: state.turn });
}

function finishTurn(state, event, effects) {
  // TODO に紐づかないエンカウントはターン終了で討伐（紐づきは TODO 完了まで残る）。
  for (const monster of [...state.monsters]) {
    if (!monster.linkedTodo) finishMonster(state, monster, event, effects);
  }
  const remaining = state.monsters.length;
  if (remaining === 0) {
    state.active = false;
    state.phase = "complete";
    pushLog(state, "turn_completed", `Turn ${state.turn} completed`, event);
    effects.push({ type: "turn_completed", track: "field" });
  } else {
    state.phase = hasEngaged(state) ? "battle" : "field";
    pushLog(state, "turn_blocked", `${remaining} monsters remain`, event);
    effects.push({ type: "turn_blocked", remaining });
  }
}

function hold(state, event, effects) {
  pushLog(state, "hold", event.summary, event);
  effects.push({ type: "hold" });
}

// SubagentStart でも精霊が1体参戦（攻撃時増援と同じ召喚）。SubagentStop で最初に出た精霊から離脱。
// 精霊を1体召喚する。実際に追加できたら true、上限/全属性在席で何もしなければ false。
function summonAlly(state, event, effects) {
  if (state.allies.length >= MAX_ALLIES) return false; // 上限（表示枠4）に達したら増援しない
  ensureActive(state, event, effects);
  // 呼ばれる精霊はランダム。ただし既に出ている属性は避ける（重複回避）＝同時に2体以上同属性は出ない。
  const present = new Set(state.allies.map((a) => a.element));
  const available = ALLY_CATALOG.filter((t) => !present.has(t.element));
  if (!available.length) return false;
  const template = available[Math.floor(chance() * available.length)];
  const ally = {
    id: `ally-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: template.name,
    sprite: template.sprite,
    element: template.element,
    appearedAt: event.at
  };
  state.allies.push(ally);
  pushLog(state, "ally_summon", ally.name, event);
  effects.push({ type: "ally_summon", ally });
  return true;
}

function returnAlly(state, event, effects) {
  const ally = state.allies.shift();
  if (!ally) {
    // 参戦記録なしで Stop が来た場合は何もしない（黙って成功扱いにしない＝effect は出さない）
    return;
  }
  pushLog(state, "ally_return", ally.name, event);
  effects.push({ type: "ally_return", allyId: ally.id });
}

function ambient(state, event, effects, type) {
  pushLog(state, type, event.summary, event);
  effects.push({ type });
}

function step(state, event, effects) {
  pushLog(state, "step", event.summary, event);
  effects.push({ type: "step" });
}

// --- 派生 ---

function currentTarget(state) {
  // 同時に1体なので先頭のエンカウントが現在の戦闘相手。
  return state.monsters[0] || null;
}

function hasEngaged(state) {
  return state.monsters.length > 0;
}

// 「本物の TODO（TodoWrite/update_plan 由来）」が進行中か。ユーザー入力の合成クエスト(synthetic)は数えない。
function hasRealTodoInProgress(state) {
  return state.quest.some((q) => q.status === "in_progress" && !q.synthetic);
}

function currentAdventureStage(state) {
  const activeQuest = state.quest.find((q) => q.status !== "completed");
  const finalQuest = state.quest[state.quest.length - 1];
  const stage = activeQuest?.stage || finalQuest?.stage || "field";
  return QUEST_STAGES.includes(stage) ? stage : "field";
}

function assignQuestStages(items) {
  const counts = questStageCounts(items.length);
  let stageIndex = 0;
  let usedInStage = 0;

  return items.map((it) => {
    while (stageIndex < counts.length - 1 && usedInStage >= counts[stageIndex]) {
      stageIndex += 1;
      usedInStage = 0;
    }
    const stage = QUEST_STAGES[stageIndex] || "castle";
    usedInStage += 1;
    return { label: it.label, status: it.status, stage };
  });
}

function questStageCounts(total) {
  const stageCount = Math.min(QUEST_STAGES.length, Math.max(0, total));
  if (stageCount === 0) return [];

  const base = Math.floor(total / stageCount);
  let remainder = total % stageCount;
  return Array.from({ length: stageCount }, () => {
    const count = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return count;
  });
}

function trackForState(state) {
  const stage = QUEST_STAGES.includes(state.adventureStage) ? state.adventureStage : "field";
  if (state.phase === "battle") {
    if (stage === "dungeon") return "dungeon-battle";
    if (stage === "castle") return "castle-battle";
    return "battle";
  }
  if (state.active && state.phase === "field") {
    if (stage === "dungeon") return "dungeon-adventure";
    if (stage === "castle") return "castle-adventure";
    return "adventure";
  }
  return "field";
}

// --- 正規化 ---

export function normalizeHookEvent(input = {}) {
  const raw = input.raw && typeof input.raw === "object" ? input.raw : {};
  const event =
    input.event ||
    raw.hook_event_name ||
    raw.hookEventName ||
    raw.event ||
    raw.type ||
    "Unknown";
  const provider = input.provider || raw.provider || "manual";
  const toolName = input.toolName || raw.tool_name || raw.toolName || raw.name || "";
  const toolInput = raw.tool_input || raw.toolInput || raw.input || {};
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  const summary =
    input.summary ||
    command ||
    raw.message ||
    raw.error?.message ||
    raw.error ||
    toolName ||
    event;

  return {
    id: input.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: input.at || new Date().toISOString(),
    provider,
    event,
    toolName,
    summary: trimLine(String(summary), 96),
    todoItems: extractTodoItems(toolName, toolInput),
    exitCode: extractExitCode(raw),
    raw
  };
}

// TodoWrite / update_plan の payload を [{label, status}] に正規化（docs §6）。
function extractTodoItems(toolName, toolInput) {
  const arrayKey = TODO_TOOLS[toolName];
  if (!arrayKey || !toolInput || typeof toolInput !== "object") return null;
  const arr = toolInput[arrayKey];
  if (!Array.isArray(arr)) return null;

  const items = arr
    .map((it) => ({
      label: String((it && (it.content ?? it.step ?? it.label ?? it.title)) || "").trim(),
      status: normalizeStatus(it && it.status)
    }))
    .filter((it) => it.label);
  return items.length ? items : null;
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (/^(completed|complete|done)$/.test(value)) return "completed";
  if (/^(in[_-]?progress|active|running|started)$/.test(value)) return "in_progress";
  return "pending";
}

// 失敗検知は exit code と明示的なエラーフラグのみ（旧版の単語マッチ正規表現は廃止）。
export function detectFailure(event) {
  const name = event.event || "";
  if (name.endsWith("Failure")) return true;
  if (name === "PermissionDenied") return true;

  const raw = event.raw || {};
  if (raw.error || raw.is_error || raw.isError || raw.success === false) return true;

  const response =
    raw.tool_response || raw.toolResponse || raw.tool_result || raw.result || raw.output || {};
  if (response && typeof response === "object") {
    if (response.error || response.is_error || response.isError || response.success === false) {
      return true;
    }
  }

  const code = event.exitCode;
  return code !== null && code !== undefined && code !== 0;
}

function extractExitCode(raw) {
  const response =
    raw.tool_response || raw.toolResponse || raw.tool_result || raw.result || raw.output || {};
  const candidates = [
    raw.exit_code,
    raw.exitCode,
    response && response.exit_code,
    response && response.exitCode,
    response && response.status,
    raw.status
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

// --- ユーティリティ ---

function pushLog(state, type, message, event) {
  state.log.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: event.at,
    type,
    message: trimLine(String(message || ""), 96),
    provider: event.provider,
    event: event.event
  });
}

// UserPromptSubmit のペイロードからユーザー入力テキストを取り出す（クエスト表示用）。改行は詰める。
function userPromptText(event) {
  const raw = event.raw || {};
  const text = String(raw.prompt || raw.user_prompt || raw.userPrompt || raw.message || "")
    .replace(/\s+/g, " ")
    .trim();
  return trimLine(text, 80);
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || createInitialState()));
}

function trimLine(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
