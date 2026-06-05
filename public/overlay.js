const phaseLabel = document.querySelector("#phaseLabel");
const monsterName = document.querySelector("#monsterName");
const monsterHp = document.querySelector("#monsterHp");
const monsterLabel = document.querySelector("#monsterLabel");
const monsterStage = document.querySelector("#monsterStage");
const roster = document.querySelector("#roster");
const allies = document.querySelector("#allies");
const toast = document.querySelector("#toast");
const sceneBg = document.querySelector("#sceneBg");
const heroImage = document.querySelector("#heroImage");
const monsterImage = document.querySelector("#monsterImage");
const hpFill = document.querySelector("#hpFill");
const audioButton = document.querySelector("#audioButton");
const resetButton = document.querySelector("#resetButton");
const fieldAudio = document.querySelector("#fieldAudio");
const adventureAudio = document.querySelector("#adventureAudio");
const battleAudio = document.querySelector("#battleAudio");
const canvas = document.querySelector("#fxCanvas");
const ctx = canvas.getContext("2d");

const phaseText = {
  idle: "待機",
  field: "探索",
  battle: "戦闘",
  complete: "Clear"
};

const spriteByName = {
  slime: "slime",
  goblin: "goblin",
  orc: "orc",
  ogre: "ogre"
};

const TRACK_FILES = {
  field: fieldAudio,
  adventure: adventureAudio,
  battle: battleAudio
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
  render(payload.state);
  effects(payload.effects || []);
});

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

resetButton.addEventListener("click", async () => {
  await fetch("/control/reset", { method: "POST" });
});

requestAnimationFrame(draw);

function render(state) {
  document.body.dataset.phase = state.phase;
  phaseLabel.textContent = phaseText[state.phase] || state.phase;
  const isResting = state.phase === "idle" || state.phase === "complete";
  sceneBg.src = isResting ? "/assets/town.png" : "/assets/field.png";
  heroImage.src = state.phase === "battle"
    ? "/assets/sprites/hero-battle.png"
    : isResting
      ? "/assets/sprites/hero-relax.png"
      : "/assets/sprites/hero.png";
  currentTrack = state.currentTrack || "field";
  if (!audio.enabled && !audio.userMuted) {
    audio.enabled = true;
    audioButton.classList.add("is-on");
  }
  setTrack(currentTrack);

  const monsters = state.monsters || [];
  const target = monsters.find((m) => m.status === "in_progress") || null;
  const pending = monsters.filter((m) => m.status !== "in_progress");
  renderRoster(pending);
  renderAllies(state.allies || []);

  if (!target) {
    // 探検中（in_progress なし）または待機: 戦闘相手を出さない
    monsterStage.dataset.active = "false";
    monsterStage.dataset.dying = "false";
    monsterName.textContent = "";
    monsterLabel.textContent = "";
    monsterHp.textContent = "";
    hpFill.style.width = "0%";
    return;
  }

  const sprite = monsterSprite(target);
  monsterStage.dataset.active = "true";
  monsterStage.dataset.dying = target.dying ? "true" : "false";
  monsterImage.src = `/assets/sprites/${sprite}.png`;
  monsterName.textContent = target.name;
  monsterLabel.textContent = target.label || "";
  monsterHp.textContent = target.dying ? "瀕死" : `${target.hp} / ${target.maxHp}`;
  hpFill.dataset.dying = target.dying ? "true" : "false";
  hpFill.style.width = `${Math.max(0, Math.round((target.hp / target.maxHp) * 100))}%`;
}

function renderRoster(pending) {
  if (!roster) return;
  if (!pending.length) {
    roster.dataset.active = "false";
    roster.textContent = "";
    return;
  }
  roster.dataset.active = "true";
  const labels = pending.map((m) => m.label).filter(Boolean).join(" ・ ");
  roster.textContent = `⚔ 待機 ${pending.length} ： ${labels}`;
}

function renderAllies(list) {
  if (!allies) return;
  if (!list.length) {
    allies.dataset.active = "false";
    allies.textContent = "";
    return;
  }
  allies.dataset.active = "true";
  allies.textContent = `🛡 仲間 ${list.length}： ${list.map((a) => a.name).join(" ・ ")}`;
}

function monsterSprite(monster) {
  if (monster.sprite && spriteByName[monster.sprite]) return monster.sprite;
  const name = String(monster.name || "").toLowerCase();
  for (const [key, sprite] of Object.entries(spriteByName)) {
    if (name.includes(key)) return sprite;
  }
  return "goblin";
}

function effects(list) {
  for (const effect of list) {
    switch (effect.type) {
      case "monster_appeared":
        burst(0.5, 0.46, "#ff5c57", 38);
        sting([43, 47, 50]);
        break;
      case "engage":
        flash("#ff8a4c");
        burst(0.52, 0.44, "#ffb15c", 28);
        sting([52, 55, 59]);
        break;
      case "attack":
        if (effect.kind === "ally") {
          // 仲間の追撃（毎回鳴るので軽く・スティングなし）
          if (!effect.stagger) burst(0.5, 0.5, "#7fe0ff", 12);
          break;
        }
        if (effect.stagger) {
          burst(0.52, 0.46, "#9fb8c8", 10);
          break;
        }
        slash();
        if (effect.kind === "skill") {
          burst(0.52, 0.42, "#ffd15c", 26);
          showToast(effect.skill || "SKILL", "skill");
          sting([81, 76]);
        } else {
          burst(0.52, 0.44, "#ffe9a8", 14);
          sting([74]);
        }
        break;
      case "counter":
        flash("#ff3b3b");
        burst(0.34, 0.5, "#ff4d4d", 28);
        showToast("反撃!", "counter");
        sting([45, 40]);
        break;
      case "monster_dying":
        flash("#c8a0ff");
        showToast("瀕死", "dying");
        break;
      case "monster_defeated":
        burst(0.5, 0.42, "#7dd873", 58);
        showToast(effect.finisher ? "撃破!" : "撃破", "win");
        sting([72, 76, 79, 84]);
        break;
      case "monster_fled":
        burst(0.5, 0.46, "#9aa6b2", 16);
        showToast("逃走", "info");
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
        showToast("仲間参戦", "info");
        sting([64, 67, 71]);
        break;
      case "ally_return":
        showToast("仲間帰還", "info");
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
}

function showToast(text, kind) {
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
  const x = rect.width * xRatio;
  const y = rect.height * yRatio;
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

function slash() {
  const rect = canvas.getBoundingClientRect();
  particles.push({
    x: rect.width * 0.5,
    y: rect.height * 0.38,
    vx: 0,
    vy: 0,
    life: 10,
    color: "#fff7dd",
    size: 26,
    slash: true
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
      ctx.rotate(-0.62);
      ctx.fillRect(-particle.size, -4, particle.size * 2.7, 8);
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
  player.volume = track === "battle" ? 0.74 : track === "adventure" ? 0.72 : 0.68;
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
  if (audio.ctx) return;
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
  if (!audio.enabled || !audio.ctx) return;
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
