// ランダムエンカウント モデル。
// モンスターは TODO 由来ではなく、ツール使用時に確率で出現する「エンカウント」。
// TODO（クエスト）は表示用の一覧であり、進行中 TODO の完了が「紐づくエンカウント」の討伐条件になる。
// この reducer は純粋関数（I/O なし）: reduceHookEvent(prev, event) -> { state, effects, normalized }。

const MONSTER_CATALOGS = {
  field: [
    { name: "Slime", element: "syntax", sprite: "slime", hp: 72, counterEffect: "blunt" },
    { name: "Goblin", element: "runtime", sprite: "goblin", hp: 96, counterEffect: "blunt" },
    { name: "Orc", element: "build", sprite: "orc", hp: 124, counterEffect: "slash" },
    { name: "Ogre", element: "logic", sprite: "ogre", hp: 156, counterEffect: "blunt" }
  ],
  dungeon: [
    { name: "Skeleton", element: "bone", sprite: "skeleton", hp: 104, counterEffect: "slash" },
    { name: "Ghoul", element: "decay", sprite: "ghoul", hp: 116, counterEffect: "slash" },
    { name: "Witch", element: "hex", sprite: "witch", hp: 108, counterEffect: "magic" },
    { name: "Grim Reaper", element: "death", sprite: "grim-reaper", hp: 144, counterEffect: "slash" },
    { name: "Succubus", element: "charm", sprite: "succubus", hp: 128, counterEffect: "magic" }
  ],
  castle: [
    { name: "Dullahan", element: "steel", sprite: "dullahan", hp: 156, counterEffect: "slash" },
    { name: "Dragon", element: "flame", sprite: "dragon", hp: 220, counterEffect: "magic", finalTodoOnly: true },
    { name: "Demon Lord", element: "abyss", sprite: "demon-lord", hp: 240, counterEffect: "magic", finalTodoOnly: true },
    { name: "Dark Mage", element: "void", sprite: "dark-mage", hp: 148, counterEffect: "magic" },
    { name: "Wolf Beastwoman", element: "moon", sprite: "wolf-beastwoman", hp: 164, counterEffect: "slash" },
    { name: "Dark Knight", element: "shadow", sprite: "dark-knight", hp: 176, counterEffect: "slash" }
  ]
};

const MAX_LOG = 80;
const SKILL_DAMAGE = 18; // PostToolUse スキル攻撃（演出用の HP 減少量。攻撃は PostToolUse だけ）

// ランダムエンカウント＆増援
const ENCOUNTER_SPAWN_CHANCE = 0.2; // ツール使用(PreToolUse)毎にモンスターが出現する確率（TODO 有無に関わらず統一）
const WILD_HITS_TO_DEFEAT = 5; // TODO 不在で出たエンカウントは hero の攻撃 N 回で討伐（HP は無関係）
const BATTLE_SUMMON_CHANCE = 0.1; // 戦闘中、ツール使用(PreToolUse)毎に精霊が1体だけ増援する確率
const MAX_ALLIES = 4; // 精霊の同時在席上限（表示枠・属性数＝4）
const ALLY_MAX_LIFE = 5; // 各精霊の被弾耐久（モンスターの反撃を5回受けると退場。要件4。サーバー権威）

// --- ペーシング（唯一の頭＝サーバーが時刻で律速する。多エージェントの洪水でも点滅させない）---
// 時刻はサーバーが reduceHookEvent に注入する（event.at＝エージェント側の時計はペーシングに使わない。
// 並行エージェントの時計はズレ・逆転しうるため）。event.at は表示/トレース専用。
const SPAWN_COOLDOWN_MS = 4000; // 討伐後、次の出現までのクールダウン
const MIN_SPAWN_INTERVAL_MS = 2000; // 連続出現の最小間隔
const MIN_MONSTER_LIFETIME_MS = 4000; // 出現から最低この時間は討伐しない（即死防止）。フロント APPEAR_ATTACK_DELAY_MS(4s) 以上に保つ。

// ゲーム確率の判定に使う乱数。テストから差し替え可能（id 生成の Math.random とは分離）。
let chance = Math.random;
export function __setChance(fn) {
  chance = typeof fn === "function" ? fn : Math.random;
}

// ペーシング用のサーバー時刻。reduceHookEvent に now を渡さなかった時の既定値を供給する seam。
// テストはこれを単調増加クロックに差し替えて決定的にする（__setChance と同じ発想）。
let nowFn = () => Date.now();
export function __setNow(fn) {
  nowFn = typeof fn === "function" ? fn : () => Date.now();
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
    hookSeq: 0, // 受信した Hook の通し番号（演出トレース用。state.json に永続化＝再起動でも連番継続）
    currentTrack: "field", // field | adventure | battle | dungeon-adventure | dungeon-battle | castle-adventure | castle-battle
    adventureStage: "field", // field | dungeon | castle
    monsters: [], // 出現中のエンカウント（同時に最大1体）
    lastSpawnAt: 0, // 直近の出現時刻（サーバー now）。出現クールダウン/最小間隔の判定に使う
    lastDefeatAt: 0, // 直近の討伐時刻（サーバー now）。出現クールダウンの判定に使う
    defeated: [],
    quest: [], // 最新 TodoWrite スナップショット（元の順序・status 付き）= クエスト一覧の表示用
    ownerSession: null, // クエスト/ターンのオーナー（要件6→動的化）。TODO で奪取・ターン終了で解放。
    subagentCounts: {}, // session_id 別の稼働サブエージェント数（オーナーのロック判定に使う。SubagentStart/Stop で増減）
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
  { name: "Ignis", sprite: "ally-fire", damagedSprite: "ally-fire-damaged", element: "fire" },
  { name: "Terra", sprite: "ally-earth", damagedSprite: "ally-earth-damaged", element: "earth" },
  { name: "Sylph", sprite: "ally-wind", damagedSprite: "ally-wind-damaged", element: "wind" },
  { name: "Aqua", sprite: "ally-water-facing-slit", damagedSprite: "ally-water-facing-slit-damaged", element: "water" }
];

export function reduceHookEvent(previousState, hookEvent, now) {
  const state = cloneState(previousState);
  // 旧/部分的な state.json を読んでもクラッシュしないよう配列を正規化（無い場合のみ）。
  if (!Array.isArray(state.monsters)) state.monsters = [];
  if (!Array.isArray(state.defeated)) state.defeated = [];
  if (!Array.isArray(state.allies)) state.allies = [];
  if (!Array.isArray(state.quest)) state.quest = [];
  if (!state.subagentCounts || typeof state.subagentCounts !== "object") state.subagentCounts = {};
  if (!QUEST_STAGES.includes(state.adventureStage)) state.adventureStage = "field";
  const event = normalizeHookEvent(hookEvent);
  const effects = [];

  // ペーシングの基準時刻はサーバーが決める（呼び出し側＝handleHook が Date.now() を渡す。
  // 渡されなければ seam の nowFn）。event.at（エージェントの時計）はここでは使わない。
  const serverNow = Number.isFinite(now) ? now : nowFn();
  event.now = serverNow;

  // この Hook に通し番号を割り当てる（演出トレースの一次キー）。id は Hook CLI 由来 or 正規化生成。
  state.hookSeq = (Number(state.hookSeq) || 0) + 1;
  event.seq = state.hookSeq;

  state.lastEvent = event;

  // 最低在席時間の遅延討伐スイープ：5撃や TODO 完了で討伐保留(pendingDefeat)になったモンスターは、
  // 出現から MIN_MONSTER_LIFETIME_MS 経過後の「次の任意の Hook」で確定討伐する（即死を防ぎつつ取りこぼさない）。
  sweepPendingDefeats(state, event, effects);

  switch (event.event) {
    case "SessionStart":
      townReset(state, event, effects);
      break;
    case "UserPromptSubmit":
      beginTurn(state, event, effects);
      break;
    case "PreToolUse":
      onPreToolUse(state, event, effects);
      break;
    case "PermissionRequest":
      hold(state, event, effects);
      break;
    case "PostToolUse":
      if (event.todoItems && canClaimQuest(state, event)) {
        // 非オーナーでも、現オーナーがロック中でなければ（アイドル）クエストを奪取して反映（要件: TODO 奪取）。
        claimQuestOwnership(state, event);
        reconcileQuest(state, event, effects);
      } else if (detectFailure(event)) {
        counter(state, event, effects);
      } else {
        // ロック中の非オーナー TODO は奪取せず＝ツール使用として戦闘駆動（§12。クエストは不変）。
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
      bumpSubagentCount(state, event, 1); // オーナーのロック判定用（summonAlly の上限とは独立に常に数える）
      break;
    case "SubagentStop":
      returnAlly(state, event, effects);
      bumpSubagentCount(state, event, -1);
      break;
    case "CounterHit":
      applyCounterHit(state, event, effects);
      break;
    case "PreCompact":
      ambient(state, event, effects, "compact_pre");
      break;
    case "PostCompact":
      ambient(state, event, effects, "compact_post");
      break;
    case "Stop":
    case "SessionEnd":
      // ターン終了は確定オーナー本人の Stop だけ（全セッションが Stop を発火するため。非オーナーの Stop は親ターンを終わらせない）。
      // owner 未確定(null)を「全員オーナー」と扱わない＝オーナー Stop で owner=null 化した後の野良 Stop による再 finishTurn を防ぐ。
      if (canEndTurn(state, event)) {
        finishTurn(state, event, effects);
      } else {
        step(state, event, effects);
      }
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
  // 単一の出口で「この Hook が生んだ全 effect」へ由来 Hook を刻む。
  // 個別の effects.push を取りこぼさないため、ここで一括して付ける（演出面すべてに由来を保証）。
  stampOrigin(effects, event);
  return { state, effects, normalized: event };
}

// すべての effect に由来 Hook を付与する。フロントはこの origin を再生/取りこぼしのトレースに使う。
function stampOrigin(effects, event) {
  for (let index = 0; index < effects.length; index += 1) {
    effects[index].origin = {
      seq: event.seq, // Hook 通し番号（順序の正準キー）
      hookId: event.id, // Hook 個体 ID（CLI 由来 or 正規化生成）
      event: event.event, // PreToolUse / PostToolUse / Stop ...
      provider: event.provider,
      tool: event.toolName || null,
      at: event.at,
      action: index // 同一 Hook 内での effect 連番（seq#index で一意参照できる）
    };
  }
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
// 出現時に進行中の TODO があれば linkedTodo=true（攻撃では倒れず TODO 完了/ターン終了で討伐）。
// 無ければ 5撃/ターン終了で討伐。
function maybeSpawnEncounter(state, event, effects) {
  if (state.monsters.length > 0) return null; // 同時に2体出現はしない
  // 出現ペーシング（唯一の頭が律速）：討伐クールダウン＋連続出現の最小間隔。
  // lastDefeatAt/lastSpawnAt が 0（未討伐/未出現＝直近イベント無し）なら経過時間を Infinity 扱い＝許可。
  // それ以外は差分で判定。負/NaN（時計逆転）なら !(x>=th) が true＝出現しない（安全側）。
  const sinceDefeat = state.lastDefeatAt ? event.now - state.lastDefeatAt : Infinity;
  const sinceSpawn = state.lastSpawnAt ? event.now - state.lastSpawnAt : Infinity;
  if (!(sinceDefeat >= SPAWN_COOLDOWN_MS)) return null;
  if (!(sinceSpawn >= MIN_SPAWN_INTERVAL_MS)) return null;
  if (chance() >= ENCOUNTER_SPAWN_CHANCE) return null;
  const linkedTodo = hasRealTodoInProgress(state); // 合成クエスト(ユーザー入力)は紐づけ対象にしない
  const stage = currentAdventureStage(state);
  const catalog = monsterCatalogForState(state, stage);
  const template = catalog[Math.floor(chance() * catalog.length)];
  const monster = {
    id: `monster-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
    linkedTodo,
    pendingDefeat: false,
    appearedAt: event.now // サーバー時刻（最低在席時間の判定に使う。表示は origin.at）
  };
  state.monsters.push(monster);
  state.lastSpawnAt = event.now;
  state.spawned += 1;
  pushLog(state, "monster_appeared", monster.label, event);
  effects.push({ type: "monster_appeared", monster });
  return monster;
}

// 出現から MIN_MONSTER_LIFETIME_MS 経過後の「次の任意の Hook」で、保留中の討伐を確定する。
// これで「5撃で即死／TODO完了で即死」でも最低在席時間は画面に残り、点滅しない（取りこぼしもしない）。
function sweepPendingDefeats(state, event, effects) {
  for (const monster of [...state.monsters]) {
    if (!monster.pendingDefeat) continue;
    const elapsed = event.now - (monster.appearedAt || 0);
    // 寿命経過で確定。時計が逆転(elapsed<0：NTP step 等でサーバー now が巻き戻った)場合も、
    // モンスターを取り残さないよう強制確定する（maybeSpawnEncounter と同じ「逆転は安全側」方針）。
    if (elapsed >= MIN_MONSTER_LIFETIME_MS || elapsed < 0) {
      finishMonster(state, monster, event, effects, true);
    }
  }
}

// force=false: 最低在席時間に満たない討伐は保留（monster.pendingDefeat=true）し、後続 Hook のスイープで確定する。
// force=true（ターン終了 Stop 等）: 寿命を無視して即討伐する（戦闘を次ターンへ持ち越さない）。
function finishMonster(state, monster, event, effects, force = false) {
  if (!force && event.now - (monster.appearedAt || 0) < MIN_MONSTER_LIFETIME_MS) {
    monster.pendingDefeat = true; // 在席が浅い＝今は倒さず保留（即死防止）
    return false;
  }
  removeMonster(state, monster);
  state.defeated.push({ ...monster, hp: 0, dying: false, defeatedAt: event.now }); // 表示用。時刻はサーバー now で統一
  state.defeatedCount += 1;
  state.lastDefeatAt = event.now; // 出現クールダウンの基準（サーバー now）
  pushLog(state, "monster_defeated", monster.label, event);
  effects.push({ type: "monster_defeated", monsterId: monster.id, finisher: true });

  // モンスターを倒すたびに在席中の精霊は全員退場（戦闘終了で消滅）。
  // 撃破演出を見せ切ってから1体ずつ順番に帰すため、出現順（FIFO）で並べ、最後の1体に last を立てる
  // （フロントは last の帰還が終わってから背景を切り替える）。属性/名前は帰還エフェクト・効果音の出し分け用。
  state.allies.forEach((ally, index) => {
    effects.push({
      type: "ally_return",
      allyId: ally.id,
      element: ally.element,
      name: ally.name,
      last: index === state.allies.length - 1
    });
  });
  state.allies = [];
  return true;
}

function removeMonster(state, monster) {
  state.monsters = state.monsters.filter((m) => m.id !== monster.id);
}

// --- 攻撃 ---

// PreToolUse：出現判定（敵不在）／精霊召喚（戦闘中）／前進（敵不在で出現せず）。
// 勇者の通常攻撃は廃止＝PreToolUse は攻撃しない。攻撃は PostToolUse のスキル攻撃だけ
// （wild の討伐ヒットも PostToolUse スキル攻撃でのみ加算される）。
function onPreToolUse(state, event, effects) {
  ensureActive(state, event, effects);
  state.steps += 1;
  // 1つの Hook では1アクションだけ：出現 / 召喚 / 前進 のいずれか1つ（攻撃はしない）。
  if (!currentTarget(state)) {
    // モンスター不在：出現判定。出たらそれが今回のアクション、出なければ前進。
    if (maybeSpawnEncounter(state, event, effects)) return;
    step(state, event, effects);
    return;
  }
  // モンスター在：精霊召喚（10%）だけ。召喚しなくても勇者は攻撃しない（PreToolUse は攻撃を出さない）。
  maybeSummonReinforcement(state, event, effects);
}

function skillAttack(state, event, effects) {
  ensureActive(state, event, effects);
  state.attacks += 1;
  const target = currentTarget(state);
  const skill = skillName(event);
  if (target) {
    damage(state, target, SKILL_DAMAGE, "skill", skill, event, effects);
    // 精霊の追撃はここでは出さない。Hook 依存にすると多エージェントで多重化するため、
    // フロント側（overlay.js）が「勇者スキル攻撃の再生時」に在席精霊から順番に演出として生成する。
  } else {
    step(state, event, effects);
  }
}

// 戦闘中、ツール使用毎に BATTLE_SUMMON_CHANCE で精霊が1体だけ増援（重複属性は避ける／上限 MAX_ALLIES）。
// 実際に1体召喚できたら true（＝今回の Hook のアクションは召喚）。確率を外した/上限などで召喚しなければ false。
function maybeSummonReinforcement(state, event, effects) {
  if (chance() >= BATTLE_SUMMON_CHANCE) return false;
  return summonAlly(state, event, effects);
}

function damage(state, monster, amount, kind, skill, event, effects) {
  const applied = Math.max(0, Math.min(amount, monster.hp));
  monster.hp = Math.max(0, monster.hp - amount); // HP は演出用
  effects.push({ type: "attack", kind, skill, monsterId: monster.id, amount: applied });
  pushLog(state, "attack", `${skill || kind} -${applied}`, event);

  // 討伐条件: linkedTodo なら攻撃では倒れない（TODO 完了かターン終了で討伐）。
  // 紐づき無しなら hero の攻撃 WILD_HITS_TO_DEFEAT 回。ただし最低在席時間に満たなければ
  // finishMonster が pendingDefeat に保留し、後続 Hook のスイープで確定する（即死防止）。
  if (!monster.linkedTodo && !monster.pendingDefeat) {
    monster.hits = (monster.hits || 0) + 1;
    if (monster.hits >= WILD_HITS_TO_DEFEAT) finishMonster(state, monster, event, effects);
  }
}

function counter(state, event, effects) {
  ensureActive(state, event, effects);
  const target = currentTarget(state);
  pushLog(state, "counter", event.toolName || event.summary, event);
  effects.push({
    type: "counter",
    skill: event.toolName,
    monsterId: target ? target.id : null,
    counterEffect: target ? target.counterEffect : "blunt"
  });
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
  state.ownerSession = null; // 新セッションでオーナーをリセット（次の UserPromptSubmit/TODO が新オーナー。要件6）
  state.subagentCounts = {}; // 稼働サブエージェントカウンタもリセット
  state.lastSpawnAt = 0; // 新セッションは出現ペーシングもリセット
  state.lastDefeatAt = 0;
  pushLog(state, "session_start", "拠点に到着", event);
  effects.push({ type: "session_start", track: "field" });
}

function beginTurn(state, event, effects) {
  // クエスト/ターンのオーナー制御。素の UserPromptSubmit でも、現オーナーがアイドル（ロックされていない）なら
  // 奪取してよい（TODO 奪取と対称）。これでアイドル/休眠オーナーにクエスト単発が張り付いて更新できなくなるのを防ぐ。
  // ただし現オーナーがロック中（進行中の本物TODO／稼働サブエージェント）なら横取りしない＝前進のみ
  // （＝作業中のオーナーを spawned codex 等が乗っ取る要件6の肝は維持）。
  if (!isOwnerSession(state, event) && ownerLocked(state)) {
    step(state, event, effects);
    return;
  }
  claimQuestOwnership(state, event); // 実 session を持つなら（初確定／アイドル奪取とも）オーナーを当該セッションへ（null は変えない＝P7）
  state.active = true;
  state.turn += 1;
  // 新ターンは出現クールダウンを引きずらない（前ターンの討伐で最初のエンカウントを律速しない）。
  state.lastSpawnAt = 0;
  state.lastDefeatAt = 0;
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
  // ターン終了は最終クリーンアップ。force=true で全モンスターを強制討伐（最低在席時間も無視）し、
  // 戦闘を次ターンへ持ち越さない。force 討伐は必ず removeMonster するので残存は起こらない
  // （＝旧 remaining>0/turn_blocked 分岐は到達不能なので撤去）。
  for (const monster of [...state.monsters]) {
    finishMonster(state, monster, event, effects, true);
  }
  state.active = false;
  state.phase = "complete";
  // ターン終了は「必ず効く安全弁」＝オーナーロックを解放する（アイドル判定が不正確でも恒久ロックにしない）。
  state.ownerSession = null; // 次ターンの最初の入力/TODO が新オーナーになれる
  state.subagentCounts = {}; // 稼働カウンタの残骸（取りこぼし含む）もクリア
  pushLog(state, "turn_completed", `Turn ${state.turn} completed`, event);
  effects.push({ type: "turn_completed", track: "field" });
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
    damagedSprite: template.damagedSprite,
    element: template.element,
    life: ALLY_MAX_LIFE, // 残りライフ（被弾で減算、0で退場。要件4）
    appearedAt: event.now // 表示用。時刻はサーバー now で統一（event.at＝エージェント時計は使わない）
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
  effects.push({ type: "ally_return", allyId: ally.id, element: ally.element, name: ally.name });
}

// モンスターの反撃ヒットを精霊1体に適用する（要件4。サーバー権威）。
// タイミング/対象選定はフロント(実クロック)が決め、ally に当たった時だけ /control/counter-hit 経由で
// CounterHit 合成イベントが届く。ここはライフ減算・0退場のみを担う（純粋関数を保つ）。
function applyCounterHit(state, event, effects) {
  const allyId = event.allyId;
  if (!allyId) return; // 対象不明＝no-op
  const ally = state.allies.find((a) => a.id === allyId);
  if (!ally) return; // 撃破済み/不在＝no-op（黙って復活/成功扱いにしない＝effect を出さない）
  // 旧 state.json（life 無し ally）互換：undefined は満タン扱い（移行時の既定。握りつぶしではなく移行措置）。
  const current = Number.isFinite(ally.life) ? ally.life : ALLY_MAX_LIFE;
  ally.life = current - 1;
  const target = currentTarget(state);
  const counterEffect = target ? target.counterEffect : "blunt";
  if (ally.life > 0) {
    effects.push({
      type: "ally_hit",
      allyId: ally.id,
      element: ally.element,
      name: ally.name,
      life: ally.life,
      monsterId: target ? target.id : null,
      counterEffect
    });
  } else {
    state.allies = state.allies.filter((a) => a.id !== ally.id); // id 指定で当該1体だけ退場
    effects.push({
      type: "ally_defeated",
      allyId: ally.id,
      element: ally.element,
      name: ally.name,
      reason: "depleted",
      monsterId: target ? target.id : null,
      counterEffect
    });
  }
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

function monsterCatalogForState(state, stage = currentAdventureStage(state)) {
  const catalog = MONSTER_CATALOGS[stage] || MONSTER_CATALOGS.field;
  if (stage !== "castle" || canSpawnFinalCastleBoss(state)) return catalog;
  return catalog.filter((monster) => !monster.finalTodoOnly);
}

function canSpawnFinalCastleBoss(state) {
  const quest = (state.quest || []).filter((q) => q && !q.synthetic);
  if (quest.length < 4) return false;
  const finalQuest = quest[quest.length - 1];
  const firstUnfinished = quest.find((q) => q.status !== "completed");
  return Boolean(firstUnfinished && firstUnfinished === finalQuest && finalQuest.stage === "castle");
}

// クエスト更新を許すのはオーナー(親)セッションだけか（要件6）。
// - オーナー未確定（null）＝まだ誰も UserPromptSubmit していない → 許可（この後オーナーになる）。
// - session_id 不明（demo/manual/旧 payload）→ 許可（弾くと検証が壊れるため）。
// - オーナー確定済みで session_id が一致 → 許可。異なる（spawned codex 等）→ 拒否。
function isOwnerSession(state, event) {
  if (!state.ownerSession) return true;
  if (!event.sessionId) return true;
  return event.sessionId === state.ownerSession;
}

// session_id 別の稼働サブエージェント数を増減（オーナーのロック判定に使う）。session 不明なら無視。
// SubagentStart/Stop は親（=起動した）セッションの session_id で発火する（実測。区別子は別途 agent_id）ので、
// 「オーナーが起動したサブエージェント/ワークフローが稼働中か」は subagentCounts[ownerSession] で分かる。
function bumpSubagentCount(state, event, delta) {
  const sid = event.sessionId;
  if (!sid) return;
  if (!state.subagentCounts || typeof state.subagentCounts !== "object") state.subagentCounts = {};
  state.subagentCounts[sid] = Math.max(0, (Number(state.subagentCounts[sid]) || 0) + delta);
}

// オーナーが「作業中」でロック（＝非オーナーの奪取を拒む）か。
// 条件：未完了の本物 TODO がある（pending/in_progress＝`status !== "completed"`。アイドル＝全完了か本物TODO無し）／
// オーナー名義の稼働サブエージェント・ワークフローがある。
// この「アイドル判定」は完全ではない（SubagentStop の取りこぼしがありうる。WF も親 session_id で
// SubagentStart/Stop を発火するのは実測確認済み＝2026-06-07）。
// 誤って“稼働中”でロックが残っても、ターン終了（オーナーStop＝finishTurn）が必ずオーナーを手放すので恒久ロックにはならない。
function ownerHasOpenTodos(state) {
  return (state.quest || []).some((q) => q && !q.synthetic && q.status !== "completed");
}
function ownerActiveSubagents(state) {
  if (!state.ownerSession) return 0;
  return Number((state.subagentCounts || {})[state.ownerSession]) || 0;
}
function ownerLocked(state) {
  return ownerHasOpenTodos(state) || ownerActiveSubagents(state) > 0;
}

// TODO（TodoWrite/update_plan）でクエストを更新・オーナー化できるか。
// - 現オーナー / オーナー未確定 / session 不明（demo/manual）→ 従来どおり可（isOwnerSession）。
// - 非オーナーでも、現オーナーがロック中でなければ（アイドル）奪取可（実 session を持つ場合のみ）。
function canClaimQuest(state, event) {
  if (isOwnerSession(state, event)) return true;
  return Boolean(event.sessionId) && !ownerLocked(state);
}

// 実 session を持つ別セッションがクエストを更新するなら、オーナーをそのセッションへ書き換える。
// session 不明（null）のときは書き換えない（null をオーナーにすると isOwnerSession が全許可になりスコープが崩れる＝P7）。
function claimQuestOwnership(state, event) {
  if (event.sessionId && state.ownerSession !== event.sessionId) {
    state.ownerSession = event.sessionId;
  }
}

// ターン終了（finishTurn）できるのは「確定オーナー本人の Stop/SessionEnd」だけ。
// P7 を Stop 側にも適用＝owner 未確定(null)を「全員オーナー」とは扱わない。さもないとオーナーの Stop が
// owner を null にした後、後続の非オーナー Stop が isOwnerSession===true に化けて再び finishTurn を呼び、
// 再活性化したターンのモンスターを強制討伐してしまう（要件5違反）。
// session 不明（demo/manual・単一フロー前提）は従来どおり終了させる（既存検証・raw:{} Stop を壊さない）。
function canEndTurn(state, event) {
  if (!event.sessionId) return true;
  return state.ownerSession === event.sessionId;
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
    sessionId: input.sessionId || raw.session_id || raw.sessionId || null, // 要件6: クエストの親セッション判定に使う
    allyId: input.allyId || raw.allyId || raw.ally_id || null, // 要件4: CounterHit の対象精霊
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
    seq: event.seq, // 由来 Hook の通し番号（effects.origin.seq と突き合わせ可能）
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

// PostToolUse のスキル技名は tool_name 基準で決める（コマンド/パッチ本文は一切見ない）。
// これにより Codex の apply_patch（command が "*** Begin Patch …"）でも技名が "***" にならない。
// - 通常ツール: アンダースコアを除いて各語頭を大文字（PascalCase）。Bash→Bash, apply_patch→ApplyPatch, spawn_agent→SpawnAgent。
// - MCP (mcp__<server>__…__<action>): 動作の1つ手前の区画＝サーバ名を PascalCase（末尾 "mcp" は除去）。
//   mcp__aiterm__pty_read→Aiterm, mcp__caveat__caveat_record→Caveat, mcp__codex_apps__x_hermes_mcp__generate_image→XHermes。
function skillName(event) {
  const tool = (event.toolName || "").trim();
  if (!tool) return "技";
  if (tool.startsWith("mcp__")) return mcpSkillName(tool);
  return pascalCase(tool.replace(/^functions\./, "")) || "技";
}

function mcpSkillName(tool) {
  const segments = tool.split("__").filter(Boolean); // ["mcp", <server…>, <action>]
  // 末尾が動作、その1つ手前がサーバ区画（区画が無ければ mcp の次）。
  const server = segments.length >= 3 ? segments[segments.length - 2] : segments[1] || "";
  const cleaned = server.replace(/_?mcp$/i, ""); // 冗長な末尾 "mcp"/"_mcp" を除去（x_hermes_mcp→x_hermes）
  return pascalCase(cleaned) || pascalCase(server) || "Mcp";
}

function pascalCase(value) {
  return String(value)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}
