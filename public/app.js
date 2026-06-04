const phaseLabel = document.querySelector("#phaseLabel");
const trackLabel = document.querySelector("#trackLabel");
const progressValue = document.querySelector("#progressValue");
const progressFill = document.querySelector("#progressFill");
const monsterName = document.querySelector("#monsterName");
const monsterTitle = document.querySelector("#monsterTitle");
const monsterHpFill = document.querySelector("#monsterHpFill");
const monsterHp = document.querySelector("#monsterHp");
const monsterQueue = document.querySelector("#monsterQueue");
const turnValue = document.querySelector("#turnValue");
const stepValue = document.querySelector("#stepValue");
const winValue = document.querySelector("#winValue");
const eventLog = document.querySelector("#eventLog");
const connectionSignal = document.querySelector("#connectionSignal");
const audioButton = document.querySelector("#audioButton");
const resetButton = document.querySelector("#resetButton");
const startButton = document.querySelector("#startButton");
const startGate = document.querySelector("#startGate");
const canvas = document.querySelector("#fxCanvas");
const ctx = canvas.getContext("2d");

const phaseText = {
  idle: "待機",
  field: "探索",
  battle: "戦闘",
  complete: "一区切り"
};

let currentState = null;
let particles = [];
let audio = {
  enabled: false,
  ctx: null,
  master: null,
  timer: null,
  step: 0,
  track: "silence"
};

connectEvents();
requestAnimationFrame(drawParticles);

startButton.addEventListener("click", async () => {
  await enableAudio();
});

audioButton.addEventListener("click", async () => {
  if (!audio.enabled) {
    await enableAudio();
    return;
  }
  audio.enabled = false;
  audioButton.classList.remove("is-on");
  startGate.classList.remove("is-hidden");
  stopAudioTimer();
});

resetButton.addEventListener("click", async () => {
  await fetch("/control/reset", { method: "POST" });
});

function connectEvents() {
  const source = new EventSource("/events");

  source.addEventListener("open", () => {
    connectionSignal.textContent = "LIVE";
    connectionSignal.classList.remove("offline");
  });

  source.addEventListener("error", () => {
    connectionSignal.textContent = "OFF";
    connectionSignal.classList.add("offline");
  });

  source.addEventListener("state", (message) => {
    const payload = JSON.parse(message.data);
    currentState = payload.state;
    renderState(payload.state);
    applyEffects(payload.effects || []);
  });
}

function renderState(state) {
  document.body.dataset.phase = state.phase;
  phaseLabel.textContent = phaseText[state.phase] || state.phase;
  trackLabel.textContent = `BGM: ${state.currentTrack}`;

  progressValue.textContent = `${state.progress}%`;
  progressFill.style.width = `${state.progress}%`;
  turnValue.textContent = state.turn;
  stepValue.textContent = state.steps;
  winValue.textContent = state.errorsDefeated;

  const monster = state.monsters[0];
  if (monster) {
    monsterName.textContent = monster.name;
    monsterTitle.textContent = monster.title;
    monsterHp.textContent = `${monster.hp} / ${monster.maxHp}`;
    monsterHpFill.style.width = `${Math.max(0, Math.round((monster.hp / monster.maxHp) * 100))}%`;
    monsterQueue.textContent = `${state.monsters.length}`;
  } else {
    monsterName.textContent = "No Error";
    monsterTitle.textContent = state.phase === "complete" ? "Quest clear" : "Field is clear";
    monsterHp.textContent = "0 / 0";
    monsterHpFill.style.width = "0%";
    monsterQueue.textContent = "0";
  }

  renderLog(state.log || []);
  setTrack(state.currentTrack);
}

function renderLog(log) {
  eventLog.replaceChildren(
    ...log
      .slice(-7)
      .reverse()
      .map((item) => {
        const li = document.createElement("li");
        const type = document.createElement("strong");
        type.textContent = item.type.replaceAll("_", " ");
        li.append(type, ` ${item.message}`);
        return li;
      })
  );
}

function applyEffects(effects) {
  for (const effect of effects) {
    if (effect.type === "monster_appeared") {
      burst(0.72, 0.55, "#ff5c57", 44);
      playSting("danger");
    }
    if (effect.type === "damage") {
      slash();
      burst(0.72, 0.52, "#ffd15c", 24);
      playSting("hit");
    }
    if (effect.type === "monster_defeated") {
      burst(0.72, 0.48, "#7dd873", 72);
      playSting("win");
    }
    if (effect.type === "turn_completed") {
      burst(0.5, 0.42, "#71d7ff", 70);
      playSting("clear");
    }
  }
}

function resizeCanvas() {
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
    const speed = 1.4 + Math.random() * 4.2;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.8,
      life: 34 + Math.random() * 26,
      color,
      size: 2 + Math.random() * 4
    });
  }
}

function slash() {
  const rect = canvas.getBoundingClientRect();
  particles.push({
    x: rect.width * 0.66,
    y: rect.height * 0.42,
    vx: 0,
    vy: 0,
    life: 12,
    color: "#f8f4dc",
    size: 26,
    slash: true
  });
}

function drawParticles() {
  resizeCanvas();
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  particles = particles.filter((particle) => particle.life > 0);
  for (const particle of particles) {
    particle.life -= 1;
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += 0.08;

    ctx.globalAlpha = Math.max(0, particle.life / 48);
    ctx.fillStyle = particle.color;

    if (particle.slash) {
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(-0.62);
      ctx.fillRect(-particle.size, -3, particle.size * 2.8, 6);
      ctx.restore();
    } else {
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(drawParticles);
}

async function enableAudio() {
  if (!audio.ctx) {
    audio.ctx = new AudioContext();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.16;
    audio.master.connect(audio.ctx.destination);
  }
  await audio.ctx.resume();
  audio.enabled = true;
  audioButton.classList.add("is-on");
  startGate.classList.add("is-hidden");
  setTrack(currentState?.currentTrack || "field");
}

function setTrack(track) {
  audio.track = track || "silence";
  if (!audio.enabled) return;
  if (audio.track === "silence") {
    stopAudioTimer();
    return;
  }
  if (!audio.timer) {
    audio.timer = window.setInterval(tickMusic, 150);
  }
}

function stopAudioTimer() {
  if (audio.timer) {
    window.clearInterval(audio.timer);
    audio.timer = null;
  }
}

function tickMusic() {
  if (!audio.enabled || !audio.ctx || audio.track === "silence") return;

  const field = [62, 66, 69, 74, 69, 66, 64, 67, 71, 76, 71, 67, 62, 69, 67, 66];
  const battle = [50, 50, 62, 65, 50, 62, 67, 65, 53, 53, 65, 68, 53, 65, 70, 68];
  const melody = audio.track === "battle" ? battle : field;
  const midi = melody[audio.step % melody.length];
  const beat = audio.step % 4 === 0;

  note(midi, audio.track === "battle" ? 0.12 : 0.18, audio.track === "battle" ? "sawtooth" : "square", beat ? 0.22 : 0.12);
  if (beat) {
    note(midi - 24, 0.22, "triangle", 0.1);
  }
  audio.step += 1;
}

function playSting(kind) {
  if (!audio.enabled || !audio.ctx) return;
  const map = {
    danger: [42, 45, 49],
    hit: [76],
    win: [72, 76, 79],
    clear: [67, 71, 74, 79]
  };
  const notes = map[kind] || [72];
  notes.forEach((midi, index) => {
    window.setTimeout(() => note(midi, 0.09, "square", 0.18), index * 70);
  });
}

function note(midi, duration, type, gainValue) {
  const time = audio.ctx.currentTime;
  const oscillator = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(gainValue, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  oscillator.connect(gain);
  gain.connect(audio.master);
  oscillator.start(time);
  oscillator.stop(time + duration + 0.02);
}
