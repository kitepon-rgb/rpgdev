const MONSTER_CATALOG = [
  { name: "Slime", hp: 72, element: "syntax", sprite: "slime" },
  { name: "Goblin", hp: 96, element: "runtime", sprite: "goblin" },
  { name: "Orc", hp: 124, element: "build", sprite: "orc" },
  { name: "Ogre", hp: 156, element: "logic", sprite: "ogre" }
];

const MAX_LOG = 80;

export function createInitialState() {
  return {
    active: false,
    phase: "idle",
    turn: 0,
    progress: 0,
    steps: 0,
    errorsFound: 0,
    errorsDefeated: 0,
    monsters: [],
    defeated: [],
    currentTrack: "field",
    lastEvent: null,
    log: []
  };
}

export function reduceHookEvent(previousState, hookEvent) {
  const state = cloneState(previousState);
  const normalized = normalizeHookEvent(hookEvent);
  const effects = [];

  state.lastEvent = normalized;

  switch (normalized.event) {
    case "UserPromptSubmit":
      startTurn(state, normalized, effects);
      break;
    case "PreToolUse":
    case "PermissionRequest":
      stepAdventure(state, normalized, effects);
      break;
    case "PostToolUseFailure":
    case "StopFailure":
    case "PermissionDenied":
      spawnMonster(state, normalized, effects);
      break;
    case "PostToolUse":
      if (detectFailure(normalized.raw, normalized.event)) {
        spawnMonster(state, normalized, effects);
      } else {
        stepAdventure(state, normalized, effects, { successfulTool: true });
      }
      break;
    case "TaskCreated":
    case "TaskCompleted":
      stepAdventure(state, normalized, effects, { taskEvent: true });
      break;
    case "Stop":
    case "SessionEnd":
      finishTurn(state, normalized, effects);
      break;
    default:
      stepAdventure(state, normalized, effects, { ambient: true });
      break;
  }

  state.currentTrack = trackForState(state);
  state.log = state.log.slice(-MAX_LOG);
  return { state, effects, normalized };
}

function trackForState(state) {
  if (state.phase === "battle") return "battle";
  if (state.active && state.phase === "field") return "adventure";
  return "field";
}

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
    raw
  };
}

export function detectFailure(raw = {}, event = "") {
  if (event.endsWith("Failure")) return true;
  if (event === "PermissionDenied") return true;
  if (raw.error || raw.is_error || raw.isError) return true;

  const response =
    raw.tool_response ||
    raw.toolResponse ||
    raw.tool_result ||
    raw.toolResult ||
    raw.result ||
    raw.output ||
    raw.response ||
    {};

  if (response.error || response.is_error || response.isError) return true;
  if (response.success === false || raw.success === false) return true;

  const exitCode = firstNumber([
    raw.exit_code,
    raw.exitCode,
    response.exit_code,
    response.exitCode,
    response.status,
    raw.status
  ]);
  if (exitCode !== null && exitCode !== 0) return true;

  const text = [
    raw.stderr,
    raw.message,
    response.stderr,
    response.text,
    response.content,
    typeof response === "string" ? response : ""
  ]
    .filter(Boolean)
    .join("\n");

  return /\b(error|failed|failure|exception|traceback|panic|fatal)\b/i.test(text);
}

function startTurn(state, event, effects) {
  beginTurn(state, event, effects);
}

function beginTurn(state, event, effects) {
  state.active = true;
  state.phase = "field";
  state.turn += 1;
  state.progress = 0;
  state.steps = 0;
  state.monsters = [];
  pushLog(state, "adventure_started", `Turn ${state.turn} started`, event);
  effects.push({ type: "adventure_started", track: "adventure" });
}

function stepAdventure(state, event, effects, options = {}) {
  if (!state.active) {
    beginTurn(state, event, effects);
  }

  state.steps += 1;

  if (state.monsters.length > 0) {
    const baseDamage = options.successfulTool ? 28 : options.taskEvent ? 18 : 12;
    damageMonster(state, event, baseDamage, effects);
    return;
  }

  const progressGain = options.ambient ? 3 : options.successfulTool ? 7 : 5;
  state.progress = Math.min(100, state.progress + progressGain);
  state.phase = "field";
  pushLog(state, "step", event.summary, event);
  effects.push({ type: "step", progressGain });
}

function spawnMonster(state, event, effects) {
  if (!state.active) {
    beginTurn(state, event, effects);
  }

  const signature = monsterSignature(event);
  const existing = state.monsters.find((monster) => monster.signature === signature);

  state.phase = "battle";
  state.errorsFound += existing ? 0 : 1;

  if (existing) {
    existing.hp = Math.min(existing.maxHp, existing.hp + 14);
    existing.enraged = true;
    pushLog(state, "monster_enraged", `${existing.name} resisted`, event);
    effects.push({ type: "monster_enraged", monsterId: existing.id });
    return;
  }

  const template = chooseMonster(event);
  const monster = {
    id: `monster-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    signature,
    name: template.name,
    element: template.element,
    sprite: template.sprite,
    maxHp: template.hp,
    hp: template.hp,
    title: buildMonsterTitle(event),
    appearedAt: event.at,
    enraged: false
  };

  state.monsters.push(monster);
  pushLog(state, "monster_appeared", monster.title, event);
  effects.push({ type: "monster_appeared", monster });
}

function damageMonster(state, event, amount, effects) {
  const monster = state.monsters[0];
  if (!monster) return;

  monster.hp = Math.max(0, monster.hp - amount);
  pushLog(state, "damage", `${monster.name} -${amount}`, event);
  effects.push({ type: "damage", monsterId: monster.id, amount });

  if (monster.hp === 0) {
    state.monsters.shift();
    state.defeated.push({ ...monster, defeatedAt: event.at });
    state.errorsDefeated += 1;
    pushLog(state, "monster_defeated", monster.name, event);
    effects.push({ type: "monster_defeated", monsterId: monster.id });
  }

  if (state.monsters.length === 0) {
    state.phase = "field";
    state.progress = Math.min(100, state.progress + 12);
    effects.push({ type: "field_restored", track: "adventure" });
  } else {
    state.phase = "battle";
  }
}

function finishTurn(state, event, effects) {
  if (state.monsters.length === 0) {
    state.active = false;
    state.phase = "complete";
    state.progress = 100;
    pushLog(state, "turn_completed", `Turn ${state.turn} completed`, event);
    effects.push({ type: "turn_completed", track: "field" });
    return;
  }

  state.phase = "battle";
  pushLog(state, "turn_blocked", `${state.monsters.length} errors remain`, event);
  effects.push({ type: "turn_blocked", remaining: state.monsters.length });
}

function chooseMonster(event) {
  const text = `${event.toolName} ${event.summary}`.toLowerCase();
  if (/build|compile|tsc|vite|webpack|rollup|npm|pnpm|yarn/.test(text)) return MONSTER_CATALOG[2];
  if (/type|undefined|null|logic|assert|test|merge|rebase|conflict/.test(text)) return MONSTER_CATALOG[3];
  if (/syntax|parse|lint|format/.test(text)) return MONSTER_CATALOG[0];
  return MONSTER_CATALOG[1];
}

function buildMonsterTitle(event) {
  const source = event.summary || event.toolName || event.event;
  return trimLine(source.replace(/\s+/g, " "), 72);
}

function monsterSignature(event) {
  const text = `${event.provider}:${event.toolName}:${event.summary}`.toLowerCase();
  return text.replace(/[^a-z0-9:_-]+/g, " ").trim().slice(0, 120);
}

function pushLog(state, type, message, event) {
  state.log.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: event.at,
    type,
    message,
    provider: event.provider,
    event: event.event
  });
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || createInitialState()));
}

function firstNumber(values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function trimLine(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
