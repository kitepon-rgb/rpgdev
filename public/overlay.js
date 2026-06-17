const phaseLabel = document.querySelector("#phaseLabel");
const monsterName = document.querySelector("#monsterName");
const monsterStage = document.querySelector("#monsterStage");
const roster = document.querySelector("#roster");
const allies = document.querySelector("#allies");
const toast = document.querySelector("#toast");
const sceneBg = document.querySelector("#sceneBg");
const heroImage = document.querySelector("#heroImage");
const monsterImage = document.querySelector("#monsterImage");
const audioButton = document.querySelector("#audioButton");
const resetButton = document.querySelector("#resetButton");
const fieldAudio = document.querySelector("#fieldAudio");
const adventureAudio = document.querySelector("#adventureAudio");
const battleAudio = document.querySelector("#battleAudio");
const dungeonAdventureAudio = document.querySelector("#dungeonAdventureAudio");
const dungeonBattleAudio = document.querySelector("#dungeonBattleAudio");
const castleAdventureAudio = document.querySelector("#castleAdventureAudio");
const castleBattleAudio = document.querySelector("#castleBattleAudio");
const SPRITE_CACHE_BUSTER = Date.now().toString(36);
const canvas = document.querySelector("#fxCanvas");
const stage = document.querySelector(".stage");
const ctx = canvas.getContext("2d");

const phaseText = {
  idle: "Town",
  field: "Explore",
  battle: "Battle",
  complete: "Clear"
};

const stageBackgrounds = {
  field: "/assets/field.png",
  dungeon: "/assets/dungeon.png",
  castle: "/assets/castle.png"
};

const spriteByName = {
  slime: "slime",
  goblin: "goblin",
  orc: "orc",
  ogre: "ogre",
  skeleton: "skeleton",
  ghoul: "ghoul",
  witch: "witch",
  "grim-reaper": "grim-reaper",
  succubus: "succubus",
  dullahan: "dullahan",
  dragon: "dragon",
  "demon-lord": "demon-lord",
  "dark-mage": "dark-mage",
  "wolf-beastwoman": "wolf-beastwoman",
  "dark-knight": "dark-knight"
};

const svgSpriteNames = new Set();

const TRACK_FILES = {
  field: fieldAudio,
  adventure: adventureAudio,
  battle: battleAudio,
  "dungeon-adventure": dungeonAdventureAudio,
  "dungeon-battle": dungeonBattleAudio,
  "castle-adventure": castleAdventureAudio,
  "castle-battle": castleBattleAudio
};

const ATTACK_SFX = {
  hero: {
    normal: "hero-normal-attack",
    skill: "hero-skill-attack",
    finisher: "hero-finisher-attack"
  },
  ally: {
    fire: "ally-fire-attack",
    earth: "ally-earth-attack",
    wind: "ally-wind-attack",
    water: "ally-water-attack"
  }
};

const HERO_ATTACK_AUDIO = {
  normal: {
    sfx: ATTACK_SFX.hero.normal,
    noises: [
      { delay: 0, duration: 0.18, volume: 0.14, cutoff: 2600 },
      { delay: 0.08, duration: 0.1, volume: 0.08, cutoff: 3800 }
    ],
    thumps: [{ midi: 35, delay: 0.1, duration: 0.14, type: "sawtooth", volume: 0.05 }]
  },
  skill: {
    sfx: ATTACK_SFX.hero.skill,
    noises: [
      { delay: 0, duration: 0.22, volume: 0.15, cutoff: 2800 },
      { delay: 0.13, duration: 0.16, volume: 0.12, cutoff: 3400 }
    ],
    thumps: [{ midi: 34, delay: 0.17, duration: 0.18, type: "sawtooth", volume: 0.06 }]
  },
  finisher: {
    sfx: ATTACK_SFX.hero.finisher,
    noises: [
      { delay: 0, duration: 0.24, volume: 0.16, cutoff: 2900 },
      { delay: 0.15, duration: 0.28, volume: 0.15, cutoff: 3200 },
      { delay: 0.28, duration: 0.18, volume: 0.12, cutoff: 1600 }
    ],
    thumps: [{ midi: 29, delay: 0.25, duration: 0.32, type: "sawtooth", volume: 0.1 }]
  }
};

const ALLY_ATTACK_AUDIO = {
  fire: {
    sfx: ATTACK_SFX.ally.fire,
    noises: [
      { delay: 0, duration: 0.42, volume: 0.18, cutoff: 1100 },
      { delay: 0.08, duration: 0.26, volume: 0.08, cutoff: 2200 }
    ],
    thumps: [{ midi: 31, delay: 0.05, duration: 0.36, type: "sawtooth", volume: 0.055 }]
  },
  earth: {
    sfx: ATTACK_SFX.ally.earth,
    noises: [
      { delay: 0, duration: 0.32, volume: 0.2, cutoff: 950 },
      { delay: 0.16, duration: 0.28, volume: 0.1, cutoff: 1500 }
    ],
    thumps: [{ midi: 24, delay: 0, duration: 0.38, type: "sawtooth", volume: 0.14 }]
  },
  wind: {
    sfx: ATTACK_SFX.ally.wind,
    noises: [
      { delay: 0, duration: 0.12, volume: 0.12, cutoff: 3800 },
      { delay: 0.12, duration: 0.12, volume: 0.12, cutoff: 4200 },
      { delay: 0.24, duration: 0.16, volume: 0.14, cutoff: 4600 }
    ],
    thumps: [{ midi: 38, delay: 0.3, duration: 0.12, type: "sawtooth", volume: 0.045 }]
  },
  water: {
    sfx: ATTACK_SFX.ally.water,
    noises: [
      { delay: 0, duration: 0.42, volume: 0.18, cutoff: 1800 },
      { delay: 0.06, duration: 0.32, volume: 0.1, cutoff: 3000 }
    ],
    thumps: [{ midi: 33, delay: 0.08, duration: 0.24, type: "sawtooth", volume: 0.06 }]
  }
};

const MUSIC = {
  field: {
    bpm: 126,
    lead: [67, 71, 74, 79, 81, 79, 76, 74, 72, 76, 79, 83, 84, 83, 79, 76, 71, 74, 79, 83, 86, 84, 83, 79, 76, 74, 72, 71, 69, 71, 74, 79],
    counter: [null, null, 55, 59, 62, null, 59, 55, null, null, 57, 60, 64, null, 60, 57, null, null, 59, 62, 66, null, 62, 59, null, null, 55, 59, 62, 64, 66, 67],
    bass: [43, 43, 50, 50, 55, 55, 50, 50, 45, 45, 52, 52, 57, 57, 52, 52],
    chords: [
      [43, 50, 55, 59],
      [45, 52, 57, 60],
      [47, 54, 59, 62],
      [48, 55, 60, 64],
      [50, 57, 62, 66],
      [52, 59, 64, 67],
      [48, 55, 60, 64],
      [50, 57, 62, 66]
    ],
    arp: [0, 2, 1, 3, 2, 1, 0, 2],
    wave: "square",
    leadVolume: 0.09,
    padVolume: 0.026,
    arpVolume: 0.034,
    counterVolume: 0.045,
    mood: "wide"
  },
  battle: {
    bpm: 168,
    lead: [52, 55, 59, 64, 63, 59, 55, 52, 54, 57, 61, 66, 65, 61, 57, 54, 59, 62, 66, 71, 70, 66, 62, 59, 57, 61, 64, 69, 68, 64, 61, 57],
    counter: [40, null, 47, 52, 51, null, 47, 40, 42, null, 49, 54, 53, null, 49, 42, 47, null, 54, 59, 58, null, 54, 47, 45, null, 52, 57, 56, null, 52, 45],
    bass: [28, 28, 40, 28, 28, 40, 35, 40, 30, 30, 42, 30, 30, 42, 37, 42],
    chords: [
      [28, 40, 47, 52],
      [30, 42, 49, 54],
      [32, 44, 51, 56],
      [35, 47, 52, 59],
      [33, 45, 52, 57],
      [30, 42, 49, 54],
      [35, 47, 54, 59],
      [28, 40, 47, 52]
    ],
    arp: [0, 1, 2, 3, 2, 1, 3, 2],
    wave: "sawtooth",
    leadVolume: 0.105,
    padVolume: 0.032,
    arpVolume: 0.045,
    counterVolume: 0.052,
    mood: "urgent"
  }
};

let currentTrack = "silence";
let particles = [];
let shakeTimer = null;
let monsterActionTimer = null;
let lastRenderedMonster = null;
let worldVisualsHeld = false; // 撃破演出中だけ true：精霊カードの即時消去を保留する（ally_return が1体ずつ帰す）
let currentHook = null; // いま処理中の state 更新の由来 Hook（origin 形）。world 効果の帰属に使う。
let latestState = null;
let latestAllies = []; // 最新の在席精霊（state.allies）。精霊追撃をフロント生成する時の名簿スナップショット。
// 召喚エフェクトが付いて来た精霊の id 集合。召喚も攻撃キューと同じ扱い＝召喚がキューで再生される(appear-hold明け)まで
// カードを出さない（出現演出と被らせない）。ally_summon 再生時に外し、その瞬間にバーストと同時へカードを出す。
const awaitingSummon = new Set();
let audio = {
  enabled: false,
  ctx: null,
  gain: null,
  compressor: null,
  players: null,
  activeTrack: "silence",
  userMuted: false,
  timer: null,
  step: 0,
  scheduledTrack: "silence",
  nextTime: 0
};

new EventSource("/events").addEventListener("state", (message) => {
  const payload = JSON.parse(message.data);
  const effectList = (payload.effects || []).slice();
  currentHook = hookOrigin(payload.event); // この更新を起こした Hook（初期スナップショット/reset は null）
  const hasDefeat = effectList.some((effect) => effect.type === "monster_defeated");
  // 撃破バッチは精霊カードの即時消去を保留（ally_return が1体ずつ帰す。末尾の world 効果で最終同期）。
  if (hasDefeat) worldVisualsHeld = true;
  // あらゆる画面変化を「一本のキュー」に集約する：背景/BGM/phase/シーンの遷移も world 効果として
  // effectList の末尾へ積む。撃破バッチなら finisher→撃破→精霊帰還→world(背景切替) の順に直列化され、
  // 「精霊が全員帰ってから背景が変わる」が自然に保証される（旧 holdWorldVisuals のタイマー hack を廃止）。
  const worldEffect = diffWorldEffect(payload.state, hasDefeat);
  if (worldEffect) effectList.push(worldEffect);
  prepareMonsterEffects(effectList);
  // 召喚エフェクト付きの精霊は、その召喚がキューで再生されるまでカードを伏せる（攻撃キューと同じ扱い）。
  for (const effect of effectList) {
    if (effect.type === "ally_summon" && effect.ally?.id) awaitingSummon.add(effect.ally.id);
  }
  render(payload.state);
  effects(effectList);
});

// --- 内部トレース（演出の再生/取りこぼし/世界遷移を由来 Hook 付きで記録）---
// overlay（デスクトップ窓の本体 UI）が「実際に何を再生し、何を捨て、いつ待たせたか」を
// サーバの /trace へ送り、.rpgdev/playback.ndjson に残す。reducer の emit ログ
// (.rpgdev/events.ndjson) と origin.seq で突き合わせれば、二連続/欠落の原因を解析できる。
let traceN = 0;
function trace(record) {
  const line = { view: "overlay", n: (traceN += 1), t: Date.now(), ...record };
  try {
    fetch("/trace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(line),
      keepalive: true
    }).catch((error) => console.error("[rpgdev] trace POST failed", error));
  } catch (error) {
    // トレースは診断専用。失敗してもゲーム進行は止めないが、黙って握りつぶさず必ず記録に残す。
    console.error("[rpgdev] trace failed", error);
  }
}

// 正規化 Hook（payload.event）を effect.origin と同形の由来情報へ変換する。
function hookOrigin(hookEvent) {
  if (!hookEvent || typeof hookEvent !== "object") return null;
  return {
    seq: hookEvent.seq,
    hookId: hookEvent.id,
    event: hookEvent.event,
    provider: hookEvent.provider,
    tool: hookEvent.toolName || null,
    at: hookEvent.at
  };
}

// 攻撃 effect の簡易ラベル（トレースの可読性用）。
function effectTag(effect) {
  if (!effect) return null;
  if (effect.type === "attack") {
    if (effect.kind === "ally") return `attack:ally:${effect.allyElement || "spirit"}`;
    if (effect.kind === "skill") return `attack:skill:${effect.skill || "?"}`;
    return "attack:normal";
  }
  return effect.type;
}

audioButton.addEventListener("click", async () => {
  if (audio.enabled) {
    audio.enabled = false;
    audio.userMuted = true;
    audioButton.classList.remove("is-on");
    stopMusic();
    return;
  }

  ensureTrackPlayers();
  if (!postNativeAudio({ enabled: true, track: currentTrack })) {
    ensureEffectAudio();
  }
  audio.enabled = true;
  audio.userMuted = false;
  audioButton.classList.add("is-on");
  setTrack(currentTrack);
});

resetButton?.addEventListener("click", async () => {
  await fetch("/control/reset", { method: "POST" });
});

requestAnimationFrame(draw);

function render(state) {
  latestState = state;
  latestAllies = state.allies || []; // 精霊追撃のフロント生成に使う最新名簿
  // state から消えた精霊(帰還/被弾退場/リセット)は召喚待ち集合からも除く＝取り残してカードを伏せ続けない。
  if (awaitingSummon.size) {
    const live = new Set(latestAllies.map((ally) => ally.id));
    for (const id of awaitingSummon) if (!live.has(id)) awaitingSummon.delete(id);
  }
  // 背景/BGM/phase/シーンは render では適用しない＝キューの world 効果が順番に適用する（単一キューへ集約）。
  renderRoster(state.quest || [], state.phase);
  // 撃破演出中(worldVisualsHeld)は精霊カードを即時に消さず保留する。
  // 帰還は ally_return が1体ずつアニメ付きで行い、末尾の world 効果で最終状態（＝空）を反映する。
  if (!worldVisualsHeld) renderAllies(state.allies || []);

  const monsters = state.monsters || [];
  const target = monsters.find((m) => m.status === "in_progress") || null;
  if (!target) {
    // 探検中（in_progress なし）または待機: 戦闘相手を出さない
    if (monsterStage.dataset.action === "defeat" || monsterStage.dataset.action === "defeat-pending") return;
    monsterStage.dataset.active = "false";
    monsterStage.dataset.dying = "false";
    monsterName.textContent = "";
    return;
  }

  const sprite = monsterSprite(target);
  monsterStage.dataset.active = "true";
  monsterStage.dataset.dying = target.dying ? "true" : "false";
  setMonsterSprite(sprite);
  monsterName.textContent = "";
  lastRenderedMonster = { ...target, sprite };
}

const worldPrev = { phase: null, stage: null, track: null }; // 直前に「キューへ積んだ」世界状態（差分検出用）

// 背景/BGM/phase/シーンの遷移をキュー項目（world 効果）に変換する。
// 変化が無く撃破解除も不要なら null。撃破バッチ(releaseDefeat)では、保留した精霊カードの最終同期のため
// 変化が無くても world 効果を出す。worldPrev は「積んだ時点」で更新し、実際の適用は再生時(applyWorld)に行う。
function diffWorldEffect(state, releaseDefeat) {
  const phase = state.phase;
  const stage = adventureStage(state);
  const track = state.currentTrack || "field";
  const changed = phase !== worldPrev.phase || stage !== worldPrev.stage || track !== worldPrev.track;
  if (!changed && !releaseDefeat) return null;
  const from = { ...worldPrev };
  worldPrev.phase = phase;
  worldPrev.stage = stage;
  worldPrev.track = track;
  // 全画面トランジションで被覆する遷移：
  //  ① 戦闘→探検/街（battle→field/complete）＝勇者配置の瞬間移動を隠す（要件5）。
  //  ② 街→探検（idle/complete→field）＝街から冒険へ入る切り替えを演出する。
  // from.phase は初回スナップショット/reset では null なので、明示的な idle/complete からの遷移だけが対象。
  const leavingBattle = from.phase === "battle" && (phase === "field" || phase === "complete");
  const enteringFieldFromTown = (from.phase === "idle" || from.phase === "complete") && phase === "field";
  const transition = leavingBattle || enteringFieldFromTown;
  return {
    type: "world",
    phase,
    stage,
    track,
    from,
    releaseDefeat: Boolean(releaseDefeat),
    transition,
    label: transition ? transitionLabel(phase, stage) : null,
    origin: currentHook
  };
}

// world 効果の再生＝背景/BGM/勇者スプライト/phase を実際に切り替える（単一キューの中で順番に適用）。
function applyWorld(effect) {
  const phase = effect.phase;
  const stageName = stageBackgrounds[effect.stage] ? effect.stage : "field";
  document.body.dataset.phase = phase;
  document.body.dataset.adventureStage = stageName;
  phaseLabel.textContent = phaseText[phase] || phase;
  const isResting = phase === "idle" || phase === "complete";
  sceneBg.src = isResting ? "/assets/town.png" : stageBackgrounds[stageName];
  heroImage.src = phase === "battle"
    ? "/assets/sprites/hero-battle.png"
    : isResting
      ? "/assets/sprites/hero-relax.png"
      : "/assets/sprites/hero.png";
  currentTrack = effect.track || "field";
  if (!audio.enabled && !audio.userMuted) {
    audio.enabled = true;
    audioButton.classList.add("is-on");
    // ネイティブ音声ブリッジが無い環境(Windows/ブラウザ)では、自動有効化時に SFX 用 WebAudio コンテキストも用意する。
    // applyWorld は button クリック(ensureEffectAudio 済み)を経由しないため、これが無いと audio.ctx が null のまま＝
    // 攻撃などの WebAudio SFX が鳴らない（攻撃スペックは notes を持たず sting=自己修復経路を通らないため）。BGM は <audio> なので鳴る。
    if (!hasNativeAudioBridge()) ensureEffectAudio();
  }
  setTrack(currentTrack);
  // どの Hook でフェーズ／ステージ（フィールド前進・街帰還）／BGM が変わったかを記録する。
  traceWorldTransition("phase", effect.from.phase, phase, effect.origin);
  traceWorldTransition("stage", effect.from.stage, stageName, effect.origin);
  traceWorldTransition("track", effect.from.track, currentTrack, effect.origin);
}

// 世界状態（phase/stage/track）が変化したら、その由来 Hook と共にトレースする。
// Hook 不在（初期スナップショット/reset）の変化は記録を出さない。
function traceWorldTransition(field, from, to, hook) {
  if (from === to || !hook) return;
  trace({ kind: "world", field, from, to, origin: hook });
}

function adventureStage(state) {
  const stage = state?.adventureStage || "field";
  return stageBackgrounds[stage] ? stage : "field";
}

// パネルが溢れないように表示する最大行数（超過分は最古の達成項目だけ畳む）。
const QUEST_MAX_ROWS = 9;

// クエスト（ミッション）トラッカー: 最新 TodoWrite スナップショットを MMO 風の一覧で描画。
// 未着手 ◇ / 進行中（現在の討伐対象）◆ / 達成 ✓。街(idle)では表示しない。
function renderRoster(quest, phase) {
  if (!roster) return;
  const items = Array.isArray(quest) ? quest.filter((it) => it && it.label) : [];
  // 全項目が完了していたらクエストウィンドウは消す（残さない）。街(idle/complete=待機)でも出さない。
  // ターン終了(complete)で街に戻ったら、未討伐の TODO が残っていてもクエスト窓は畳む
  // （AI が TODO に止めを刺さず complete になることがあり、街で TODO が残ると違和感が出るため）。
  const allDone = items.length > 0 && items.every((it) => it.status === "completed");
  if (!items.length || phase === "idle" || phase === "complete" || allDone) {
    roster.dataset.active = "false";
    roster.replaceChildren();
    return;
  }
  roster.dataset.active = "true";

  const total = items.length;
  const doneCount = items.filter((it) => it.status === "completed").length;

  // 進行中・未着手は必ず残し、行が多すぎるときだけ先頭（最古の達成）を畳む。
  let visible = items;
  let folded = 0;
  if (items.length > QUEST_MAX_ROWS) {
    folded = items.length - QUEST_MAX_ROWS;
    visible = items.slice(folded);
  }

  const head = document.createElement("div");
  head.className = "roster-head";
  const crest = document.createElement("span");
  crest.className = "roster-crest";
  crest.textContent = "❖";
  const title = document.createElement("span");
  title.className = "roster-title";
  // TODO（TodoWrite/update_plan）由来は「連続」、TODO 不在時のユーザー入力(synthetic)は「単発」。
  const isSynthetic = items.some((it) => it.synthetic);
  title.textContent = isSynthetic ? "Quest (one-off)" : "Quest (ongoing)";
  const count = document.createElement("span");
  count.className = "roster-count";
  count.textContent = `${doneCount} / ${total}`;
  head.append(crest, title, count);

  const list = document.createElement("div");
  list.className = "roster-list";
  if (folded > 0) {
    list.append(questRow("completed", `ほか ${folded} 件 達成`, true));
  }
  for (const item of visible) {
    list.append(questRow(item.status, item.label, false));
  }

  roster.replaceChildren(head, list);
}

function questRow(status, label, folded) {
  const kind = status === "completed" ? "done" : status === "in_progress" ? "active" : "todo";
  const row = document.createElement("div");
  row.className = `roster-item is-${kind}${folded ? " is-folded" : ""}`;
  const mark = document.createElement("span");
  mark.className = "roster-mark";
  mark.textContent = kind === "done" ? "✓" : kind === "active" ? "◆" : "◇";
  const text = document.createElement("span");
  text.className = "roster-text";
  text.textContent = label;
  row.append(mark, text);
  return row;
}

function renderAllies(list) {
  if (!allies) return;
  // 召喚待ち(awaitingSummon)の精霊は、ally_summon がキューで再生されるまでカードを出さない（攻撃キューと同じ扱い）。
  const visible = list.filter((ally) => !(ally.id && awaitingSummon.has(ally.id)));
  if (!visible.length) {
    allies.dataset.active = "false";
    allies.replaceChildren();
    return;
  }
  allies.dataset.active = "true";
  allies.replaceChildren(
    ...visible.slice(-4).map((ally, index) => {
      const card = document.createElement("div");
      card.className = `ally ally-${ally.element || "spirit"}`;
      card.dataset.allyId = ally.id || "";
      card.style.setProperty("--slot", index);

      const image = document.createElement("img");
      image.src = allySpritePath(allyRenderSprite(ally));
      image.alt = "";

      const name = document.createElement("span");
      name.textContent = ally.name || "Spirit";

      card.append(image, name);
      return card;
    })
  );
}

function monsterSprite(monster) {
  if (monster.sprite && spriteByName[monster.sprite]) return monster.sprite;
  const name = String(monster.name || "").toLowerCase();
  for (const [key, sprite] of Object.entries(spriteByName)) {
    if (name.includes(key)) return sprite;
  }
  return "goblin";
}

// 攻撃アニメは常に1体ずつ（勇者を含む）。攻撃キューは 1 秒間隔で次へ。
// 演出はグローバルなキューで直列化し、複数バッチが重なって連続再生されないようにする。
let fxQueue = [];
let fxBusy = false;
let monsterDefeatInProgress = false;
let appearAttackHoldUntil = 0; // この時刻(ms)まで attack の再生を保留（出現演出と被らせない）
const ANIM_GAP = 100; // アニメ間の空き（0.1 秒）
// 勇者・精霊の攻撃と精霊召喚は、種別を問わず前のキュー再生開始から1秒後に次を再生する（前のキューが無ければ即座）。
const ATTACK_QUEUE_INTERVAL_MS = 1000;
// キュー再生はモンスター登場の4秒後に開始する（出現演出を見せ切ってから初撃/召喚）。サーバーの最低在席時間
// (MIN_MONSTER_LIFETIME_MS=4s)と一致＝登場4秒後の初撃が、討伐可能になる瞬間とちょうど揃う。
const APPEAR_ATTACK_DELAY_MS = 4000;
const MAX_QUEUED_ATTACKS = 10; // 詰まりすぎ防止（超過した攻撃アニメは間引く）

// --- モンスターの反撃ループ（要件2）---
// 生存モンスターが居て、勇者＋全精霊の攻撃を再生し切り（キュー枯渇）、出現演出も明けたら、
// 8秒おきにモンスターが反撃する。対象は勇者と在席精霊からランダム。タイミングは実クロックを持つ
// フロントだけが駆動できる（reducer はタイマー非保持＝§12）。精霊に当たればサーバーへ通知してライフ確定。
const COUNTER_INTERVAL_MS = 8000;
let counterTimer = null;
let counterSeq = 0;

function startCounterLoop() {
  if (counterTimer) return;
  counterTimer = window.setInterval(runCounterTick, COUNTER_INTERVAL_MS);
}

function stopCounterLoop() {
  if (!counterTimer) return;
  window.clearInterval(counterTimer);
  counterTimer = null;
}

// 反撃を許す条件：モンスター在席・撃破処理中でない・出現演出が明けている・キューが空（攻撃を全部再生済み）。
function counterLoopAllowed() {
  return (
    !latestState?.layoutPreview &&
    monsterStage?.dataset.active === "true" &&
    !monsterDefeatInProgress &&
    appearAttackHoldUntil <= Date.now() &&
    !fxBusy &&
    fxQueue.length === 0
  );
}

function runCounterTick() {
  if (!counterLoopAllowed()) {
    stopCounterLoop(); // 条件が崩れたら止める（キュー枯渇時に pumpFx が再開する）
    return;
  }
  // 対象母集団＝勇者 + 在席精霊(life>0)。ランダムに1体。
  const livingAllies = (latestAllies || []).filter((ally) => (ally.life ?? 5) > 0);
  const targets = [{ kind: "hero" }, ...livingAllies.map((ally) => ({ kind: "ally", allyId: ally.id }))];
  const target = targets[Math.floor(Math.random() * targets.length)];
  if (target.kind === "ally") {
    // 精霊への反撃はサーバー権威：CounterHit を投げ、被弾演出はサーバーの ally_hit/ally_defeated 受信で再生する
    // （ローカルでも演出すると二重になるため、ここでは演出しない）。
    reportCounterHit(`counter-${(counterSeq += 1)}-${Date.now()}`, target.allyId);
  } else {
    // 勇者はサーバーに state を持たない＝被弾演出をローカルで直接再生（演出のみ）。
    playEffect({ type: "monster_counter", target: "hero", synthetic: true, counterEffect: currentCounterEffect() });
  }
}

// フロントの反撃ヒットをサーバーへ通知（要件4。サーバーがライフ減算・退場を確定して再 broadcast）。
function reportCounterHit(hitId, allyId) {
  try {
    fetch("/control/counter-hit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hitId, allyId }),
      keepalive: true
    }).catch((error) => console.error("[rpgdev] counter-hit POST failed", error));
  } catch (error) {
    console.error("[rpgdev] counter-hit failed", error);
  }
}

// そのエフェクトのアニメが終わるまでの目安(ms)。0 は即時（アニメ枠を占有せず次へ）。
function fxAnimMs(effect) {
  switch (effect.type) {
    case "attack":
      if (effect.stagger) return 300;
      return effect.kind === "skill" ? 560 : 520;
    case "counter":
      return 420;
    case "monster_counter":
    case "ally_hit":
      return 360; // 被弾リアクション（要件3）
    case "ally_defeated":
      return 520; // 精霊の被弾退場（要件4）
    case "world":
      return effect.transition ? 1500 : 0; // 全画面トランジションのみキューを占有（要件5）。通常 world は即時。
    case "monster_dying":
      return 320;
    case "monster_defeated":
      return 520;
    case "finisher":
      return 640; // 会心の一撃（斬撃）を見せ切ってから撃破へ進む
    case "ally_return":
      return 560; // 撃破後、精霊を1体ずつ順番に帰す（キューを占有して整列退場させる）
    case "ally_summon":
      return 400; // 精霊召喚も攻撃キューと同様にキュー枠を占有（appear-hold + 1秒間隔の対象）
    default:
      return 0; // 出現・CLEAR 等はアニメを占有しない（即時）
  }
}

function effects(list) {
  if (!Array.isArray(list) || !list.length) return;
  stopCounterLoop(); // 新バッチ到来＝戦況が動く。反撃ループは一旦止め、キュー枯渇時に pumpFx が再開する（要件2）。
  if (list.some((effect) => effect.type === "monster_appeared")) {
    monsterDefeatInProgress = false;
  }

  const hasDefeat = list.some((effect) => effect.type === "monster_defeated");
  if (hasDefeat) {
    clearStaleCombatQueueForDefeat("defeat-received");
  }

  let defeatQueued = monsterDefeatInProgress || fxQueue.some((effect) => effect.type === "monster_defeated");
  for (const effect of list) {
    if (defeatQueued && effect.type === "attack") {
      // 撃破が確定したバッチ以降の攻撃は再生しない＝由来 Hook 付きで「取りこぼし」を記録。
      trace({ kind: "drop", tag: effectTag(effect), reason: "defeat-queued", origin: effect.origin });
      continue;
    }
    if (effect.type === "attack") {
      const queued = fxQueue.reduce((n, e) => (e.type === "attack" ? n + 1 : n), 0);
      if (queued >= MAX_QUEUED_ATTACKS) {
        trace({ kind: "drop", tag: effectTag(effect), reason: "max-queued", origin: effect.origin });
        continue; // 間引き
      }
    }
    if (effect.type === "monster_defeated") {
      // 撃破の前に、まだ再生していない攻撃（トドメに至った一連の攻撃）はそのまま流し、
      // その後に会心の一撃（finisher）→撃破とする。攻撃アニメは捨てない＝欠落させない。
      // ただし撃破がキューに入った後の別バッチ攻撃は、モンスター消滅後に漏れて見えるため受け付けない。
      // finisher はフロント合成（synthetic）。由来は撃破を起こした Hook を引き継ぐ。
      fxQueue.push({ type: "finisher", synthetic: true, origin: effect.origin });
      defeatQueued = true;
      fxQueue.push(effect); // 撃破。背景切替はバッチ末尾の world 効果が担う（精霊帰還の後）。
      continue;
    }
    fxQueue.push(effect);
  }
  pumpFx();
}

function pumpFx() {
  if (fxBusy) return;
  while (fxQueue.length) {
    const effect = fxQueue[0]; // まだ消費しない（保留判定のため覗くだけ）
    if (monsterDefeatInProgress && (effect.type === "attack" || effect.type === "ally_summon")) {
      fxQueue.shift();
      trace({ kind: "drop", tag: effectTag(effect), reason: "defeat-in-progress", origin: effect.origin });
      continue;
    }
    // 出現演出と被らせない：出現開始から APPEAR_ATTACK_DELAY_MS の間は攻撃/召喚キューを再生しない。
    if (effect.type === "attack" || effect.type === "ally_summon") {
      const wait = appearAttackHoldUntil - Date.now();
      if (wait > 0) {
        trace({ kind: "hold", tag: effectTag(effect), reason: "appear-hold", wait, origin: effect.origin });
        fxBusy = true;
        window.setTimeout(() => {
          fxBusy = false;
          pumpFx();
        }, wait);
        return; // shift せずに待つ（保留が明けてから同じ攻撃を再生）
      }
    }
    fxQueue.shift();
    trace({
      kind: "play",
      tag: effectTag(effect),
      attackKind: effect.kind,
      skill: effect.skill,
      allyElement: effect.allyElement,
      synthetic: effect.synthetic,
      origin: effect.origin
    });
    playEffect(effect);
    // 勇者スキル攻撃を再生したら、在席精霊の追撃をフロント生成で直後に割り込ませる（Hook非依存）。
    // これで Hook の数で精霊攻撃が多重化せず、画面側で「スキル→精霊が順番に追撃」になる。
    if (effect.type === "attack" && effect.kind === "skill" && !effect.synthetic) {
      enqueueSpiritFollowup(effect);
    }
    const anim = fxAnimMs(effect);
    if (anim > 0) {
      // 攻撃キューは固定 1 秒、その他はアニメ目安 + 0.1 秒待って次へ。
      fxBusy = true;
      window.setTimeout(() => {
        fxBusy = false;
        pumpFx();
      }, fxQueueDelayMs(effect, anim));
      return;
    }
    // anim === 0 の即時エフェクトは待たずに続けて処理。
  }
  // キュー枯渇＝勇者スキル＋全精霊追撃を再生し切った。モンスター生存中なら反撃ループを始める（要件2）。
  if (counterLoopAllowed()) startCounterLoop();
}

function fxQueueDelayMs(effect, anim) {
  // 勇者攻撃・精霊追撃・精霊召喚は種別を問わず一律 1 秒間隔（前のキュー再生開始から1秒後）。
  if (effect.type === "attack" || effect.type === "ally_summon") {
    return ATTACK_QUEUE_INTERVAL_MS;
  }
  return anim + ANIM_GAP;
}

// 勇者スキル攻撃の再生に続けて、在席精霊（latestAllies）の追撃をキュー先頭へ割り込ませる。
// Hook 依存ではなく画面側の演出なので、Hook が何回来ても「スキル1回につき精霊が1巡」だけ。
// 撃破中は追撃しない（撃破演出を優先）。撃破時の defeat-clear で未再生の追撃は破棄される。
function enqueueSpiritFollowup(skillEffect) {
  if (monsterDefeatInProgress) return;
  if (!Array.isArray(latestAllies) || !latestAllies.length) return;
  // キュー上限(MAX_QUEUED_ATTACKS)を超えないぶんだけ積む（スキル連打でも攻撃キューを詰まらせない）。
  const queuedAttacks = fxQueue.reduce((n, e) => (e.type === "attack" ? n + 1 : n), 0);
  const budget = MAX_QUEUED_ATTACKS - queuedAttacks;
  if (budget <= 0) return;
  // 要件1: 在席精霊は全員が勇者スキルの後に追撃する。順番はランダム（Fisher-Yates でコピーをシャッフル）。
  // latestAllies 本体は破壊しない（表示順・次回追撃に影響させない）。被弾退場した精霊(life<=0)と
  // まだ召喚演出が出ていない精霊(awaitingSummon＝カード未表示)は除外＝ゴースト追撃を生成しない。
  const roster = latestAllies.filter((ally) => (ally.life ?? 5) > 0 && !awaitingSummon.has(ally.id));
  for (let i = roster.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [roster[i], roster[j]] = [roster[j], roster[i]];
  }
  const followups = roster.slice(0, budget).map((ally) => ({
    type: "attack",
    kind: "ally",
    synthetic: true,
    allyId: ally.id,
    allyElement: ally.element,
    origin: skillEffect.origin // 由来は親スキルの Hook を引き継ぐ
  }));
  fxQueue.unshift(...followups); // 親スキルの直後（他の後続より前）に割り込ませる
}

function clearStaleCombatQueueForDefeat(reason = "defeat-clear") {
  // 攻撃・finisher・未再生の精霊召喚は撃破時に掃除する（召喚も攻撃キューと同じ扱い）。ally_return は残す。
  const stale = (effect) =>
    effect.type === "attack" || effect.type === "finisher" || effect.type === "ally_summon";
  for (const effect of fxQueue) {
    if (stale(effect)) {
      trace({ kind: "drop", tag: effectTag(effect), reason, origin: effect.origin });
    }
  }
  fxQueue = fxQueue.filter((effect) => !stale(effect));
  appearAttackHoldUntil = 0;
  stopCounterLoop(); // 撃破処理中は反撃しない（要件2）
}

function playEffect(effect) {
  switch (effect.type) {
    case "monster_appeared":
      // 出現開始時刻を基準に、以後 4 秒は攻撃キューの再生を保留する（出現演出と被らせない）。
      appearAttackHoldUntil = Date.now() + APPEAR_ATTACK_DELAY_MS;
      if (effect.monster) {
        const sprite = monsterSprite(effect.monster);
        lastRenderedMonster = { ...effect.monster, sprite };
        setMonsterSprite(sprite);
        monsterName.textContent = "";
        monsterStage.dataset.active = "true";
      }
      setMonsterAction("appear", 700);
      monsterAppearImpact();
      monsterAppearSound();
      break;
    case "engage":
      flash("#ff8a4c");
      burst(0.52, 0.44, "#ffb15c", 28);
      sting([52, 55, 59]);
      break;
    case "attack":
      if (effect.kind === "ally") {
        // 再生時点で精霊が既に居なければ（帰還等で消えた）追撃を出さない＝ゴースト攻撃防止。
        if (effect.allyId && allies && !allies.querySelector(`[data-ally-id="${effect.allyId}"]`)) break;
        pulseAlly(effect.allyId, effect.stagger ? "stagger" : "assist");
        const element = allyElement(effect);
        spawnMonsterImpact(element);
        allyElementImpact(element, effect.stagger);
        shakeStage(effect.stagger ? "light" : "hit");
        allyAttackSound(element, effect.stagger);
        break;
      }
      if (effect.kind === "skill") {
        slash("skill");
        shakeStage(effect.stagger ? "light" : "skill");
        monsterBurst(effect.stagger ? "#d8c7ff" : "#ffd15c", effect.stagger ? 18 : 34);
        monsterBurst("#f0b73a", effect.stagger ? 10 : 18);
        showSkillBanner(effect.skill || "SKILL");
        heroAttackSound("skill", effect.stagger);
      } else {
        slash("normal");
        shakeStage(effect.stagger ? "light" : "hit");
        monsterBurst(effect.stagger ? "#9fb8c8" : "#ffe9a8", effect.stagger ? 12 : 24);
        heroAttackSound("normal", effect.stagger);
      }
      break;
    case "counter":
      flash("#ff3b3b");
      if (effect.monsterId) {
        heroHitReaction(counterEffectKind(effect.counterEffect));
      } else {
        const rect = canvas.getBoundingClientRect();
        counterImpact(counterEffectKind(effect.counterEffect), { x: rect.width * 0.34, y: rect.height * 0.54 }, 0.9);
      }
      sting([45, 40]);
      break;
    case "monster_counter":
      // モンスターの反撃を勇者が食らった（要件3。勇者は state ライフ無し＝演出のみ）。
      heroHitReaction(counterEffectKind(effect.counterEffect));
      flash("#ff5a4d");
      shakeStage("hit");
      damageSound();
      break;
    case "ally_hit":
      // サーバー確定の精霊被弾（CounterHit→ally_hit）。残ライフは render が反映。被弾演出＋音（要件3/4）。
      allyHitImpact(effect.allyId, effect.element, counterEffectKind(effect.counterEffect));
      flash("#ff5a4d");
      damageSound();
      break;
    case "ally_defeated":
      // 精霊が5回被弾して退場（被弾死。撃破時の ally_return とは別演出）（要件4）。
      allyHitImpact(effect.allyId, effect.element, counterEffectKind(effect.counterEffect), 1.18);
      returnSpiritCard(effect.allyId, effect.element);
      flash("#ff5a4d");
      damageSound();
      break;
    case "monster_dying":
      flash("#c8a0ff");
      break;
    case "finisher":
      // 勇者の会心の一撃。撃破の直前に必ず1回流す（モンスターはまだ画面に居る）。
      // トドメ演出ではスキル名称（技名カットイン）は出さない＝視覚演出と効果音のみ。
      flash("#fff4c2");
      slash("skill");
      window.setTimeout(() => slash("skill"), 150); // 二段斬りで会心らしさを出す
      shakeStage("skill");
      monsterBurst("#ffd15c", 40);
      monsterBurst("#fff7dd", 22);
      heroAttackSound("finisher");
      break;
    case "monster_defeated":
      monsterDefeatInProgress = true; // 以後（次の出現まで）に届く攻撃アニメは破棄する
      clearStaleCombatQueueForDefeat("defeat-play"); // 攻撃/finisher は掃除、ally_return は残す
      holdDefeatedMonster();
      monsterDefeatImpact();
      monsterDefeatSound();
      // 背景/BGM 切替は、このバッチ末尾に積まれた world 効果が（撃破→精霊帰還の後に）担う。
      break;
    case "monster_fled":
      burst(0.5, 0.46, "#9aa6b2", 16);
      break;
    case "retreat":
      showToast("後退", "info");
      break;
    case "turn_completed":
      burst(0.5, 0.42, "#7dd873", 70);
      showToast("CLEAR", "win");
      sting([72, 76, 79, 84, 88]);
      break;
    case "turn_blocked":
      showToast(`未討伐 ${effect.remaining}`, "info");
      break;
    case "ally_summon":
      // 召喚をキューで再生する瞬間に、伏せていたカードを出す＝バースト/トーストとカード表示を同時にする。
      if (effect.ally?.id) awaitingSummon.delete(effect.ally.id);
      renderAllies(latestAllies);
      summonBurst();
      pulseAlly(effect.ally?.id, "summon");
      showToast(`${effect.ally?.name || "仲間"} 召喚`, "ally");
      sting([64, 67, 71, 76]);
      break;
    case "ally_return":
      // 撃破演出のあと、精霊を1体ずつ順番に帰す（属性色のエフェクト＋効果音つき）。
      // 背景切替は末尾の world 効果が担うので、ここでは帰還演出だけ。
      returnSpiritCard(effect.allyId, effect.element);
      allyReturnSound(effect.element);
      break;
    case "world":
      // 戦闘→探検の遷移は全画面トランジションで被覆し、その最中に背景/勇者/phase を差し替える（要件5）。
      // それ以外（通常の world 変化）は即時適用。
      if (effect.transition) {
        playSceneTransition(effect);
      } else {
        // 背景/BGM/勇者スプライト/phase をこのタイミングで切り替える（単一キューの順番どおり）。
        applyWorld(effect);
        if (effect.releaseDefeat) {
          worldVisualsHeld = false; // 精霊が全員帰った＝撃破時の保留を解除
          renderAllies(latestAllies); // 保留していた精霊カードを最終同期（撃破後＝空）
        }
      }
      break;
    case "compact_pre":
      showToast("記憶が霞む…", "info");
      break;
    case "compact_post":
      showToast("霧が晴れた", "info");
      break;
    case "hold":
      showToast("!", "info");
      break;
    default:
      break;
  }
}

function showToast(text, kind) {
  if (isMonsterTextSuppressed()) return;
  if (!toast || !text) return;
  const item = document.createElement("div");
  item.className = `toast-item toast-${kind || "info"}`;
  item.textContent = text;
  toast.appendChild(item);
  requestAnimationFrame(() => item.classList.add("in"));
  window.setTimeout(() => item.classList.add("out"), 1100);
  window.setTimeout(() => item.remove(), 1500);
  while (toast.children.length > 4) toast.removeChild(toast.firstChild);
}

function showSkillBanner(skill) {
  if (!stage) return;
  const item = document.createElement("div");
  item.className = "skill-cutin";
  item.textContent = `${formatSkillName(skill)}!!`;
  stage.appendChild(item);
  window.setTimeout(() => item.classList.add("out"), 760);
  window.setTimeout(() => item.remove(), 980);
}

function isMonsterTextSuppressed() {
  if (!monsterStage) return false;
  return monsterStage.dataset.active === "true" || Boolean(monsterStage.dataset.action);
}

// 技名は reducer 側で tool_name 基準に整形済み（PascalCase / MCP はサーバ名）。
// ここでは表示用に長さを切り詰めるだけ（先頭単語抜き出し等の加工はしない）。
function formatSkillName(value) {
  const text = String(value || "SKILL").trim() || "SKILL";
  return text.length > 18 ? `${text.slice(0, 17)}...` : text;
}

function allySpritePath(sprite) {
  const name = String(sprite || "ally-fire");
  const ext = svgSpriteNames.has(name) ? "svg" : "png";
  return `/assets/sprites/${name}.${ext}?v=${SPRITE_CACHE_BUSTER}`;
}

function allyRenderSprite(ally) {
  const sprite = String(ally?.sprite || "ally-fire");
  if (ally?.element === "fire" && sprite === "ally-fire" && (ally.life ?? 5) <= 3) {
    return "ally-fire-damaged";
  }
  if (ally?.element === "earth" && sprite === "ally-earth" && (ally.life ?? 5) <= 3) {
    return "ally-earth-damaged";
  }
  if (ally?.element === "water" && sprite === "ally-water-facing-slit" && (ally.life ?? 5) <= 3) {
    return "ally-water-damaged";
  }
  if (ally?.element === "wind" && sprite === "ally-wind" && (ally.life ?? 5) <= 3) {
    return "ally-wind-damaged";
  }
  return sprite;
}

function pulseAlly(allyId, kind) {
  if (!allies || !allyId) return;
  const card = allies.querySelector(`[data-ally-id="${allyId}"]`);
  if (!card) return;
  card.dataset.action = kind;
  window.setTimeout(() => {
    if (card.dataset.action === kind) delete card.dataset.action;
  }, 520);
}

const ELEMENT_COLORS = { fire: "#ff7a35", earth: "#d6b16a", wind: "#caff8a", water: "#72e8ff" };

// 撃破後の精霊帰還：該当カードを帰還アニメ（data-action="return"）＋属性色の上昇エフェクトで消す。
function returnSpiritCard(allyId, element) {
  const card = allyId && allies ? allies.querySelector(`[data-ally-id="${allyId}"]`) : null;
  allyReturnImpact(element, card);
  if (!card) return;
  card.dataset.action = "return";
  window.setTimeout(() => card.remove(), 520); // 帰還アニメが終わってからカードを消す
}

function allyReturnImpact(element, card) {
  const center = cardCanvasCenter(card);
  const color = ELEMENT_COLORS[element] || "#cfeaff";
  for (let index = 0; index < 20; index += 1) {
    particles.push({
      x: center.x + randomRange(-13, 13),
      y: center.y + randomRange(-8, 10),
      vx: randomRange(-0.7, 0.7),
      vy: randomRange(-3.4, -1.3), // 光が上へ還る
      life: randomRange(22, 40),
      color: index % 3 === 0 ? "#ffffff" : color,
      size: randomRange(2, 4)
    });
  }
  particles.push({ kind: "ring", x: center.x, y: center.y + 6, vx: 0, vy: 0, life: 16, maxLife: 16, color, size: 30 });
}

function cardCanvasCenter(card) {
  const rect = canvas.getBoundingClientRect();
  if (!card) return { x: rect.width * 0.5, y: rect.height * 0.72 };
  const box = card.getBoundingClientRect();
  return { x: box.left - rect.left + box.width * 0.5, y: box.top - rect.top + box.height * 0.5 };
}

function allyReturnSound(element) {
  if (postNativeAudio({ sfx: "ally-return" })) return;
  // ネイティブブリッジが無い時の合成音：光に還る上昇音。
  const base = allyElementNotes(element, false);
  sting([...base, base[base.length - 1] + 12]);
}

// 勇者の被弾演出（要件3）：後退リアクション＋勇者位置のインパクト。
function heroHitReaction(kind = currentCounterEffect()) {
  if (heroImage) {
    heroImage.dataset.action = "hit";
    window.setTimeout(() => {
      if (heroImage.dataset.action === "hit") delete heroImage.dataset.action;
    }, 460);
  }
  const center = heroCanvasCenter();
  counterImpact(kind, center, 1.12);
}

// 精霊の被弾演出（要件3/4）：カードのヒットリアクション＋カード位置のインパクト。
function allyHitImpact(allyId, element, kind = currentCounterEffect(), scale = 1) {
  pulseAlly(allyId, "hit");
  const card = allyId && allies ? allies.querySelector(`[data-ally-id="${allyId}"]`) : null;
  const center = cardCanvasCenter(card);
  counterImpact(kind, center, scale);
}

function currentCounterEffect() {
  return counterEffectKind(lastRenderedMonster?.counterEffect);
}

function counterEffectKind(value) {
  return ["slash", "blunt", "magic"].includes(value) ? value : "blunt";
}

function counterImpact(kind, center, scale = 1) {
  const effect = counterEffectKind(kind);
  spawnDamageImpact(effect, center, scale);
  switch (effect) {
    case "slash":
      slashImpactAt(center, scale);
      break;
    case "magic":
      magicImpactAt(center, scale);
      break;
    case "blunt":
    default:
      bluntImpactAt(center, scale);
      break;
  }
}

function spawnDamageImpact(kind, center, scale = 1) {
  if (!stage) return;
  const item = document.createElement("div");
  item.className = `damage-impact damage-${counterEffectKind(kind)}`;
  item.style.left = `${center.x}px`;
  item.style.top = `${center.y}px`;
  item.style.setProperty("--damage-scale", `${scale}`);
  stage.appendChild(item);
  window.setTimeout(() => item.remove(), 760);
}

function slashImpactAt(center, scale = 1) {
  const count = scale > 1 ? 4 : 3;
  for (let index = 0; index < count; index += 1) {
    particles.push({
      slash: true,
      x: center.x + randomRange(-8, 8),
      y: center.y + randomRange(-10, 10),
      vx: randomRange(-0.4, 0.4),
      vy: randomRange(-0.5, 0.2),
      life: 14 + index * 2,
      maxLife: 18,
      color: index % 2 === 0 ? "#fff7dd" : "#ff5a4d",
      size: (28 + index * 8) * scale,
      thickness: (5 - index * 0.45) * scale,
      rotation: -0.72 + index * 0.34
    });
  }
  burstAt(center.x, center.y, "#ff6a5a", Math.round(14 * scale));
}

function bluntImpactAt(center, scale = 1) {
  burstAt(center.x, center.y, "#ff8a4c", Math.round(24 * scale));
  for (let index = 0; index < Math.round(12 * scale); index += 1) {
    particles.push({
      kind: "shard",
      x: center.x + randomRange(-14, 14),
      y: center.y + randomRange(-10, 12),
      vx: randomRange(-3.6, 3.6),
      vy: randomRange(-4.6, -0.8),
      life: randomRange(18, 30),
      maxLife: 30,
      color: index % 2 === 0 ? "#ffd15c" : "#7b3f35",
      size: randomRange(3, 7) * scale,
      rotation: randomRange(0, Math.PI)
    });
  }
  particles.push({ kind: "ring", x: center.x, y: center.y, vx: 0, vy: 0, life: 16, maxLife: 16, color: "#ff5a4d", size: 34 * scale });
}

function magicImpactAt(center, scale = 1) {
  for (let index = 0; index < Math.round(30 * scale); index += 1) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      x: center.x + Math.cos(angle) * randomRange(4, 34 * scale),
      y: center.y + Math.sin(angle) * randomRange(4, 28 * scale),
      vx: Math.cos(angle) * randomRange(0.6, 2.6),
      vy: Math.sin(angle) * randomRange(0.6, 2.6) - 0.4,
      life: randomRange(18, 36),
      color: index % 3 === 0 ? "#fff7ff" : index % 3 === 1 ? "#c58cff" : "#72e8ff",
      size: randomRange(2, 5) * scale
    });
  }
  particles.push({ kind: "ring", x: center.x, y: center.y, vx: 0, vy: 0, life: 18, maxLife: 18, color: "#c58cff", size: 44 * scale });
  particles.push({ kind: "ring", x: center.x, y: center.y, vx: 0, vy: 0, life: 14, maxLife: 14, color: "#72e8ff", size: 28 * scale });
}

function heroCanvasCenter() {
  const rect = canvas.getBoundingClientRect();
  if (!heroImage) return { x: rect.width * 0.18, y: rect.height * 0.72 };
  const box = heroImage.getBoundingClientRect();
  return { x: box.left - rect.left + box.width * 0.5, y: box.top - rect.top + box.height * 0.5 };
}

// 被ダメージ効果音（要件3）。ネイティブブリッジがあれば damage-hit.wav、無ければ合成音にフォールバック。
function damageSound() {
  if (postNativeAudio({ sfx: "damage-hit" })) return;
  if (!audio.enabled) {
    sting([40, 35]);
    return;
  }
  if (!audio.ctx) ensureEffectAudio();
  if (!audio.ctx) return;
  const time = audio.ctx.currentTime;
  noiseAt(time, 0.18, 0.2, 360);
  noteAt(33, time, 0.26, "sawtooth", 0.16);
  noteAt(28, time + 0.04, 0.3, "triangle", 0.12);
}

// 戦闘→探検の全画面トランジション（要件5）：タイトル一枚絵＋テキストが右上→中央静止→左下へ抜ける。
// 被覆ピークで applyWorld（背景/勇者/phase 差替）を行い、勇者配置の瞬間移動を隠す。
function playSceneTransition(effect) {
  const el = document.querySelector("#sceneTransition");
  if (!el) {
    // 要素が無ければ通常適用（無言フォールバックにしない＝コンソールに残す）。
    console.error("[rpgdev] #sceneTransition missing; applying world without transition");
    applyWorld(effect);
    if (effect.releaseDefeat) {
      worldVisualsHeld = false;
      renderAllies(latestAllies);
    }
    return;
  }
  const textEl = el.querySelector(".scene-transition-text");
  if (textEl) textEl.textContent = effect.label || "Explore";
  el.hidden = false;
  void el.offsetWidth; // リフローしてからアニメ開始
  el.dataset.active = "true";
  // 被覆ピーク（テキスト中央静止）で背景/勇者/phase を差し替える＝瞬間移動を隠す。
  window.setTimeout(() => {
    applyWorld(effect);
    if (effect.releaseDefeat) {
      worldVisualsHeld = false;
      renderAllies(latestAllies);
    }
  }, 700);
  // テキストが左下へ抜け切ったら層を隠す。
  window.setTimeout(() => {
    el.dataset.active = "false";
    el.hidden = true;
  }, 1500);
}

function transitionLabel(phase, stage) {
  if (phase === "complete") return "Return to Town";
  if (stage === "dungeon") return "Explore the Dungeon";
  if (stage === "castle") return "Storm the Castle";
  return "Explore the Field";
}

function prepareMonsterEffects(list) {
  if (!Array.isArray(list)) return;
  if (!list.some((effect) => effect.type === "monster_defeated")) return;
  primeDefeatedMonster();
}

function primeDefeatedMonster() {
  const monster = lastRenderedMonster;
  if (monster) {
    const sprite = monsterSprite(monster);
    setMonsterSprite(sprite);
    monsterName.textContent = "";
  }
  monsterStage.dataset.active = "true";
  monsterStage.dataset.dying = "false";
  if (monsterStage.dataset.action !== "defeat") {
    monsterStage.dataset.action = "defeat-pending";
  }
}

function setMonsterAction(action, duration) {
  if (!monsterStage) return;
  if (monsterActionTimer) window.clearTimeout(monsterActionTimer);
  resetMonsterVisualEffect();
  delete monsterStage.dataset.action;
  void monsterStage.offsetWidth;
  monsterStage.dataset.action = action;
  monsterActionTimer = window.setTimeout(() => {
    if (monsterStage.dataset.action !== action) return;
    delete monsterStage.dataset.action;
    if (action === "appear") resetMonsterVisualEffect(true);
  }, duration);
}

function resetMonsterVisualEffect(forceRest = false) {
  if (!monsterStage) return;
  monsterStage.style.removeProperty("filter");
  if (forceRest) {
    monsterStage.style.filter = getComputedStyle(monsterStage).getPropertyValue("--monster-rest-filter").trim()
      || "drop-shadow(0 13px 9px rgba(0, 0, 0, 0.42))";
  }
}

function holdDefeatedMonster() {
  const monster = lastRenderedMonster;
  if (monster) {
    const sprite = monsterSprite(monster);
    setMonsterSprite(sprite);
    monsterName.textContent = "";
  }
  monsterStage.dataset.active = "true";
  monsterStage.dataset.dying = "false";
  setMonsterAction("defeat", 820);
  window.setTimeout(() => {
    if (monsterStage.dataset.action === "defeat") return;
    monsterStage.dataset.active = "false";
    monsterName.textContent = "";
  }, 840);
}

function setMonsterSprite(sprite) {
  const name = spriteByName[sprite] || "goblin";
  monsterStage.dataset.sprite = name;
  monsterImage.src = `/assets/sprites/${name}.png?v=${SPRITE_CACHE_BUSTER}`;
}

function allyElement(effect) {
  if (effect.allyElement) return effect.allyElement;
  const card = effect.allyId ? allies?.querySelector(`[data-ally-id="${effect.allyId}"]`) : null;
  if (!card) return "spirit";
  for (const element of ["fire", "earth", "wind", "water"]) {
    if (card.classList.contains(`ally-${element}`)) return element;
  }
  return "spirit";
}

function allyElementNotes(element, stagger) {
  if (stagger) return [71, 67];
  const notes = {
    fire: [52, 64, 76],
    earth: [43, 50, 55],
    wind: [74, 78, 86],
    water: [62, 69, 74]
  };
  return notes[element] || [64, 67, 71];
}

function heroAttackSound(kind, stagger = false) {
  attackSound(HERO_ATTACK_AUDIO[kind] || HERO_ATTACK_AUDIO.normal, stagger);
}

function allyAttackSound(element, stagger = false) {
  const spec = ALLY_ATTACK_AUDIO[element] || { notes: allyElementNotes(element, stagger) };
  attackSound(spec, stagger);
}

function attackSound(spec, stagger = false) {
  if (spec.sfx && postNativeAudio({ sfx: spec.sfx })) return;

  const notes = stagger && spec.staggerNotes ? spec.staggerNotes : spec.notes;
  if (Array.isArray(notes) && notes.length) sting(notes);

  if (!audio.enabled || !audio.ctx) return;
  const time = audio.ctx.currentTime;
  const intensity = stagger ? 0.58 : 1;
  for (const noise of spec.noises || []) {
    noiseAt(time + (noise.delay || 0), noise.duration, noise.volume * intensity, noise.cutoff);
  }
  for (const thump of spec.thumps || []) {
    noteAt(thump.midi, time + (thump.delay || 0), thump.duration, thump.type, thump.volume * intensity, thump.detune || 0);
  }
}

function allyElementImpact(element, stagger = false) {
  const center = monsterCanvasCenter();
  switch (element) {
    case "fire":
      fireImpact(stagger, center);
      break;
    case "earth":
      earthImpact(stagger, center);
      break;
    case "wind":
      windImpact(stagger, center);
      break;
    case "water":
      waterImpact(stagger, center);
      break;
    default:
      burstAt(center.x, center.y, stagger ? "#9fb8c8" : "#7fe0ff", stagger ? 10 : 18);
      break;
  }
}

function spawnMonsterImpact(element) {
  if (!stage) return;
  const known = ["fire", "earth", "wind", "water"].includes(element) ? element : "spirit";
  const center = monsterStageCenter();
  const size = monsterImpactSize();
  const item = document.createElement("div");
  item.className = `monster-impact impact-${known}`;
  item.style.left = `${center.x}px`;
  item.style.top = `${center.y}px`;
  item.style.width = `${size.width}px`;
  item.style.height = `${size.height}px`;
  stage.appendChild(item);
  window.setTimeout(() => item.remove(), 900);
}

function shakeStage(kind) {
  if (!stage) return;
  stage.dataset.shake = kind;
  if (shakeTimer) window.clearTimeout(shakeTimer);
  shakeTimer = window.setTimeout(() => {
    delete stage.dataset.shake;
  }, 260);
}

function summonBurst() {
  flash("#7fe0ff");
  burst(0.2, 0.72, "#7fe0ff", 38);
  burst(0.28, 0.62, "#ffe08a", 26);
}

function monsterAppearImpact() {
  const rect = canvas.getBoundingClientRect();
  const baseX = rect.width * 0.5;
  const baseY = rect.height * 0.46;
  flash("#7a4dff");
  for (let index = 0; index < 4; index += 1) {
    particles.push({
      kind: "ring",
      x: baseX,
      y: baseY + 18,
      vx: 0,
      vy: 0,
      life: 18 + index * 5,
      maxLife: 18 + index * 5,
      color: index % 2 === 0 ? "#b96cff" : "#ff5c57",
      size: 46 + index * 24
    });
  }
  for (let index = 0; index < 42; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      kind: "smoke",
      x: baseX + Math.cos(angle) * randomRange(12, 54),
      y: baseY + Math.sin(angle) * randomRange(8, 36),
      vx: Math.cos(angle) * randomRange(0.4, 1.8),
      vy: Math.sin(angle) * randomRange(0.2, 1.2) - 0.7,
      life: randomRange(24, 46),
      maxLife: 46,
      color: index % 2 === 0 ? "#6d4aa8" : "#ff6a6a",
      size: randomRange(8, 22)
    });
  }
  for (let index = 0; index < 30; index += 1) {
    particles.push({
      x: baseX + randomRange(-70, 70),
      y: baseY + randomRange(-50, 54),
      vx: randomRange(-1.8, 1.8),
      vy: randomRange(-2.8, -0.2),
      life: randomRange(20, 38),
      color: index % 2 === 0 ? "#ffd15c" : "#c58cff",
      size: randomRange(2, 5)
    });
  }
}

function monsterDefeatImpact() {
  const rect = canvas.getBoundingClientRect();
  const baseX = rect.width * 0.5;
  const baseY = rect.height * 0.45;
  flash("#fff0a8");
  for (let index = 0; index < 54; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      kind: "shard",
      x: baseX + randomRange(-34, 34),
      y: baseY + randomRange(-44, 48),
      vx: Math.cos(angle) * randomRange(2.0, 6.2),
      vy: Math.sin(angle) * randomRange(1.4, 5.2) - 1.7,
      life: randomRange(24, 44),
      maxLife: 44,
      color: index % 4 === 0 ? "#fff7dd" : index % 4 === 1 ? "#ffd15c" : index % 4 === 2 ? "#7dd873" : "#9fb8c8",
      size: randomRange(4, 11),
      rotation: randomRange(0, Math.PI)
    });
  }
  for (let index = 0; index < 3; index += 1) {
    particles.push({
      kind: "ring",
      x: baseX,
      y: baseY + 18,
      vx: 0,
      vy: 0,
      life: 16 + index * 4,
      maxLife: 16 + index * 4,
      color: index === 0 ? "#fff7dd" : "#7dd873",
      size: 54 + index * 30
    });
  }
}

function monsterAppearSound() {
  if (postNativeAudio({ sfx: "monster-appear" })) return;
  sting([26, 31, 36]);
  if (!audio.enabled || !audio.ctx) return;
  const time = audio.ctx.currentTime;
  noiseAt(time, 0.24, 0.12, 260);
  noteAt(26, time, 0.42, "sawtooth", 0.14);
  noteAt(31, time + 0.08, 0.34, "triangle", 0.1);
}

function monsterDefeatSound() {
  if (postNativeAudio({ sfx: "monster-defeat" })) return;
  sting([31, 28, 24]);
  if (!audio.enabled || !audio.ctx) return;
  const time = audio.ctx.currentTime;
  noiseAt(time, 0.34, 0.18, 320);
  noiseAt(time + 0.18, 0.62, 0.12, 220);
  noteAt(31, time, 0.6, "sawtooth", 0.14);
  noteAt(24, time + 0.2, 0.9, "triangle", 0.1);
}

function spawnSlashMark(kind) {
  if (!stage) return;
  const center = monsterStageCenter();
  const item = document.createElement("div");
  item.className = `slash-mark slash-${kind}`;
  item.style.left = `${center.x}px`;
  item.style.top = `${center.y}px`;
  stage.appendChild(item);
  window.setTimeout(() => item.remove(), 420);
}

let flashFrames = 0;
let flashColor = "#ffffff";
function flash(color) {
  flashColor = color || "#ffffff";
  flashFrames = 8;
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function burst(xRatio, yRatio, color, count) {
  const rect = canvas.getBoundingClientRect();
  burstAt(rect.width * xRatio, rect.height * yRatio, color, count);
}

function monsterBurst(color, count) {
  const center = monsterCanvasCenter();
  burstAt(center.x, center.y, color, count);
}

function burstAt(x, y, color, count) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 3.4;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.4,
      life: 26 + Math.random() * 20,
      color,
      size: 2 + Math.random() * 3
    });
  }
}

function fireImpact(stagger, center = monsterCanvasCenter()) {
  const baseX = center.x;
  const baseY = center.y;
  const count = stagger ? 18 : 38;
  for (let index = 0; index < count; index += 1) {
    particles.push({
      kind: "flame",
      x: baseX + randomRange(-17, 17),
      y: baseY + randomRange(-3, 21),
      vx: randomRange(-0.85, 0.85),
      vy: randomRange(-4.4, -1.4),
      life: randomRange(24, 42),
      maxLife: 42,
      color: index % 3 === 0 ? "#ffd15c" : index % 3 === 1 ? "#ff7a35" : "#ff3b27",
      size: randomRange(4, 9)
    });
  }
  particles.push({
    kind: "ring",
    x: baseX,
    y: baseY + 10,
    vx: 0,
    vy: 0,
    life: 18,
    maxLife: 18,
    color: "#ff7a35",
    size: stagger ? 18 : 28
  });
}

function earthImpact(stagger, center = monsterCanvasCenter()) {
  const baseX = center.x;
  const baseY = center.y;
  const count = stagger ? 16 : 34;
  for (let index = 0; index < count; index += 1) {
    particles.push({
      kind: "shard",
      x: baseX + randomRange(-13, 13),
      y: baseY + randomRange(-5, 11),
      vx: randomRange(-3.6, 3.6),
      vy: randomRange(-5.4, -1.1),
      life: randomRange(24, 38),
      maxLife: 38,
      color: index % 3 === 0 ? "#d6b16a" : index % 3 === 1 ? "#7b6042" : "#9fc56a",
      size: randomRange(2.5, 6),
      rotation: randomRange(0, Math.PI)
    });
  }
  particles.push({
    kind: "ring",
    x: baseX,
    y: baseY + 6,
    vx: 0,
    vy: 0,
    life: 14,
    maxLife: 14,
    color: "#d6b16a",
    size: stagger ? 21 : 35
  });
}

function windImpact(stagger, center = monsterCanvasCenter()) {
  const baseX = center.x;
  const baseY = center.y;
  const count = stagger ? 2 : 4;
  for (let index = 0; index < count; index += 1) {
    particles.push({
      slash: true,
      x: baseX + randomRange(-16, 15),
      y: baseY + index * 9.5 + randomRange(-5, 6),
      vx: randomRange(0.6, 1.8),
      vy: randomRange(-0.5, 0.4),
      life: 16 + index * 2,
      maxLife: 20,
      color: index % 2 === 0 ? "#caff8a" : "#7fe0ff",
      size: stagger ? 21 : 36,
      thickness: stagger ? 2.5 : 4,
      rotation: -0.78 + index * 0.26
    });
  }
  for (let index = 0; index < (stagger ? 10 : 22); index += 1) {
    particles.push({
      x: baseX + randomRange(-30, 10),
      y: baseY + randomRange(-17, 31),
      vx: randomRange(2.6, 5.2),
      vy: randomRange(-1.2, 1.2),
      life: randomRange(14, 28),
      color: index % 2 === 0 ? "#eaffd4" : "#99ffd0",
      size: randomRange(1, 2.5)
    });
  }
}

function waterImpact(stagger, center = monsterCanvasCenter()) {
  const baseX = center.x;
  const baseY = center.y;
  const count = stagger ? 18 : 42;
  for (let index = 0; index < count; index += 1) {
    particles.push({
      kind: "droplet",
      x: baseX + randomRange(-18, 18),
      y: baseY + randomRange(-8, 13),
      vx: randomRange(-3.4, 3.4),
      vy: randomRange(-5.0, -0.8),
      life: randomRange(20, 36),
      maxLife: 36,
      color: index % 3 === 0 ? "#d8fbff" : index % 3 === 1 ? "#72e8ff" : "#3aa7ff",
      size: randomRange(1.5, 4)
    });
  }
  particles.push({
    kind: "wave",
    x: baseX - 4,
    y: baseY + 11,
    vx: 0,
    vy: 0,
    life: 18,
    maxLife: 18,
    color: "#72e8ff",
    size: stagger ? 21 : 34
  });
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function monsterCanvasCenter() {
  return monsterCenterRelativeTo(canvas);
}

function monsterStageCenter() {
  return monsterCenterRelativeTo(stage);
}

function monsterImpactSize() {
  const targetRect = monsterImage?.getBoundingClientRect() || monsterStage?.getBoundingClientRect();
  if (!targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
    const stageRect = stage?.getBoundingClientRect();
    return {
      width: Math.max(1, (stageRect?.width || 1) * 0.2),
      height: Math.max(1, (stageRect?.height || 1) * 0.2)
    };
  }
  return {
    width: Math.max(1, targetRect.width * 0.66),
    height: Math.max(1, targetRect.height * 0.59)
  };
}

function monsterCenterRelativeTo(container) {
  const containerRect = container?.getBoundingClientRect();
  const targetRect = monsterImage?.getBoundingClientRect() || monsterStage?.getBoundingClientRect();
  if (!containerRect) return { x: 0, y: 0 };
  if (!targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
    return { x: containerRect.width * 0.5, y: containerRect.height * 0.5 };
  }
  return {
    x: targetRect.left - containerRect.left + targetRect.width * 0.5,
    y: targetRect.top - containerRect.top + targetRect.height * 0.5
  };
}

function slash(kind = "normal") {
  const center = monsterCanvasCenter();
  spawnSlashMark(kind);
  const baseColor = kind === "skill" ? "#ffd15c" : "#fff7dd";
  const accentColor = kind === "skill" ? "#f0b73a" : "#ffe9a8";
  for (let index = 0; index < (kind === "skill" ? 3 : 2); index += 1) {
    particles.push({
      x: center.x + index * 10,
      y: center.y + index * 8,
      vx: 0,
      vy: -0.3,
      life: 16 - index * 2,
      maxLife: 16 - index * 2,
      color: index === 1 ? accentColor : baseColor,
      size: kind === "skill" ? 38 + index * 7 : 31 + index * 5,
      thickness: kind === "skill" ? 9 - index : 7 - index,
      rotation: -0.66 + index * 0.38,
      slash: true
    });
  }
  particles.push({
    x: center.x,
    y: center.y,
    vx: 0,
    vy: 0,
    life: 18,
    maxLife: 18,
    color: accentColor,
    size: kind === "skill" ? 58 : 38,
    ring: true
  });
}

function draw() {
  resize();
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (flashFrames > 0) {
    ctx.globalAlpha = Math.min(0.35, flashFrames / 24);
    ctx.fillStyle = flashColor;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.globalAlpha = 1;
    flashFrames -= 1;
  }

  particles = particles.filter((particle) => particle.life > 0);

  for (const particle of particles) {
    particle.life -= 1;
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += 0.08;
    ctx.globalAlpha = Math.max(0, particle.life / 34);
    ctx.fillStyle = particle.color;
    if (particle.slash) {
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation || -0.62);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = particle.color;
      ctx.lineWidth = particle.thickness || 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-particle.size * 1.15, 0);
      ctx.lineTo(particle.size * 1.7, 0);
      ctx.stroke();
      ctx.lineWidth = Math.max(2, (particle.thickness || 7) * 0.42);
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(-particle.size * 0.78, 0);
      ctx.lineTo(particle.size * 1.18, 0);
      ctx.stroke();
      ctx.restore();
    } else if (particle.ring || particle.kind === "ring") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = particle.color;
      ctx.lineWidth = 4;
      const progress = 1 - particle.life / (particle.maxLife || 18);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * progress, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (particle.kind === "wave") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = particle.color;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      const progress = 1 - particle.life / (particle.maxLife || 18);
      ctx.beginPath();
      ctx.ellipse(particle.x, particle.y, particle.size * progress, particle.size * 0.28 * progress, -0.18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (particle.kind === "flame") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(particle.x, particle.y);
      const scale = Math.max(0.25, particle.life / (particle.maxLife || 42));
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.moveTo(0, -particle.size * 1.4 * scale);
      ctx.lineTo(particle.size * 0.7 * scale, particle.size * 0.6 * scale);
      ctx.lineTo(-particle.size * 0.6 * scale, particle.size * 0.7 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (particle.kind === "shard") {
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate((particle.rotation || 0) + particle.life * 0.08);
      ctx.fillStyle = particle.color;
      ctx.fillRect(-particle.size * 0.5, -particle.size * 0.35, particle.size, particle.size * 0.7);
      ctx.restore();
    } else if (particle.kind === "droplet") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (particle.kind === "smoke") {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(draw);
}

function setTrack(track) {
  currentTrack = track;
  if (!audio.enabled) return;

  if (postNativeAudio({ enabled: true, track })) {
    audio.activeTrack = track;
    return;
  }

  ensureTrackPlayers();

  if (track === audio.activeTrack && audio.players?.[track] && !audio.players[track].paused) return;

  for (const [name, player] of Object.entries(audio.players)) {
    if (name !== track) player.pause();
  }

  if (track === "silence") {
    stopMusic();
    return;
  }

  const player = audio.players[track];
  if (!player) return;
  player.volume = track === "dungeon-adventure" ? 0.86 : track.includes("battle") ? 0.74 : track.includes("adventure") ? 0.72 : 0.68;
  if (audio.activeTrack !== track) player.currentTime = 0;
  player.play().catch(() => {
    audio.enabled = false;
    audioButton.classList.remove("is-on");
    audioButton.title = "BGM playback failed";
  });
  audio.activeTrack = track;
}

function stopMusic() {
  postNativeAudio({ enabled: false, track: "silence" });
  if (audio.players) {
    Object.values(audio.players).forEach((player) => {
      player.pause();
    });
  }
  if (audio.timer) {
    window.clearInterval(audio.timer);
    audio.timer = null;
  }
  audio.activeTrack = "silence";
  audio.scheduledTrack = "silence";
}

function postNativeAudio(message) {
  const bridge = window.webkit?.messageHandlers?.rpgdev;
  if (!bridge) return false;
  bridge.postMessage(message);
  return true;
}

function hasNativeAudioBridge() {
  return Boolean(window.webkit?.messageHandlers?.rpgdev);
}

function ensureTrackPlayers() {
  if (audio.players) return;
  audio.players = TRACK_FILES;
  Object.values(audio.players).forEach((player) => {
    player.loop = true;
    player.preload = "auto";
  });
}

function ensureEffectAudio() {
  if (audio.ctx) {
    // 既存コンテキストが suspended（自動再生ポリシー等で停止）なら再開する＝SFX が無音にならない保険。
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    return;
  }
  audio.ctx = new AudioContext();
  audio.gain = audio.ctx.createGain();
  audio.compressor = audio.ctx.createDynamicsCompressor();
  audio.gain.gain.value = 0.18;
  audio.compressor.threshold.value = -18;
  audio.compressor.knee.value = 18;
  audio.compressor.ratio.value = 5;
  audio.compressor.attack.value = 0.006;
  audio.compressor.release.value = 0.16;
  audio.gain.connect(audio.compressor);
  audio.compressor.connect(audio.ctx.destination);
  audio.ctx.resume();
}

function scheduleMusic() {
  if (!audio.enabled || !audio.ctx || currentTrack === "silence") return;

  const track = MUSIC[currentTrack];
  if (!track) return;

  const stepDuration = 60 / track.bpm / 2;
  while (audio.nextTime < audio.ctx.currentTime + 0.28) {
    scheduleStep(track, audio.step, audio.nextTime);
    audio.step += 1;
    audio.nextTime += stepDuration;
  }
}

function scheduleStep(track, step, time) {
  const lead = track.lead[step % track.lead.length];
  const counter = track.counter[step % track.counter.length];
  const bass = track.bass[step % track.bass.length];
  const chord = track.chords[Math.floor(step / 4) % track.chords.length];
  const arpNote = chord[track.arp[step % track.arp.length]] + (track.mood === "urgent" ? 24 : 12);
  const strongBeat = step % 4 === 0;
  const barStart = step % 8 === 0;
  const stepDuration = 60 / track.bpm / 2;

  if (lead !== null) {
    noteAt(lead, time, stepDuration * 0.95, track.wave, track.leadVolume);
    noteAt(lead + 12, time + 0.004, stepDuration * 0.72, "triangle", track.leadVolume * 0.28);
    noteAt(lead, time + 0.007, stepDuration * 0.7, "sine", track.leadVolume * 0.2, -7);
  }

  if (counter !== null && step % 2 === 1) {
    noteAt(counter, time + 0.01, stepDuration * 0.82, "triangle", track.counterVolume);
  }

  if (bass !== null) {
    noteAt(bass, time, strongBeat ? stepDuration * 1.9 : stepDuration * 0.82, "triangle", strongBeat ? 0.13 : 0.08);
    if (strongBeat) noteAt(bass + 12, time + 0.012, stepDuration * 1.4, "square", 0.04);
  }

  if (strongBeat) {
    chordAt(chord, time + 0.018, stepDuration * 3.6, track.padVolume);
  }

  if (track.mood === "wide") {
    noteAt(arpNote, time + 0.02, stepDuration * 0.7, "triangle", track.arpVolume);
    if (barStart) chordAt(chord.map((midi) => midi + 12), time + 0.04, stepDuration * 7.4, track.padVolume * 0.7);
  } else {
    noteAt(arpNote, time + 0.015, stepDuration * 0.55, "square", track.arpVolume);
    if (barStart) chordAt(chord.map((midi) => midi + 12), time + 0.02, stepDuration * 1.8, track.padVolume * 1.35);
  }

  if (track.mood === "urgent") {
    if (step % 4 === 0) noiseAt(time, 0.09, 0.11, 520);
    if (step % 4 === 2) noiseAt(time, 0.055, 0.065, 1700);
    if (step % 8 === 6) noiseAt(time, 0.04, 0.04, 2400);
  } else if (step % 8 === 0) {
    noteAt(lead - 12, time + 0.02, stepDuration * 1.4, "sine", 0.045);
  }
}

function sting(notes) {
  if (!audio.enabled) return;
  if (!audio.ctx) ensureEffectAudio();
  if (!audio.ctx) return;
  notes.forEach((midi, index) => {
    noteAt(midi, audio.ctx.currentTime + index * 0.065, 0.1, "square", 0.16);
  });
}

function chordAt(notes, time, duration, volume) {
  notes.forEach((midi, index) => {
    noteAt(midi, time + index * 0.012, duration, "triangle", volume);
    noteAt(midi + 12, time + index * 0.012, duration * 0.82, "sine", volume * 0.45);
  });
}

function noteAt(midi, time, duration, type, volume, detune = 0) {
  if (!audio.ctx) return;
  const oscillator = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), time);
  oscillator.detune.setValueAtTime(detune, time);
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(volume, time + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  oscillator.connect(gain);
  gain.connect(audio.gain);
  oscillator.start(time);
  oscillator.stop(time + duration + 0.03);
}

function noiseAt(time, duration, volume, cutoff) {
  if (!audio.ctx) return;
  const length = Math.max(1, Math.floor(audio.ctx.sampleRate * duration));
  const buffer = audio.ctx.createBuffer(1, length, audio.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }

  const source = audio.ctx.createBufferSource();
  const filter = audio.ctx.createBiquadFilter();
  const gain = audio.ctx.createGain();
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoff, time);
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.gain);
  source.start(time);
  source.stop(time + duration);
}
