#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = join(ROOT, "public", "audio");
const SAMPLE_RATE = 44100;

await mkdir(OUT_DIR, { recursive: true });

const sfx = [
  {
    name: "hero-normal-attack",
    duration: 0.55,
    build(mix) {
      addSlash(mix, 0.02, 0.28, 0.92);
      addFilteredNoise(mix, {
        start: 0.1,
        duration: 0.16,
        volume: 0.32,
        highpass: 520,
        lowpass: 2600,
        attack: 0.004,
        decay: 7,
        seed: 11,
        texture: "scrape"
      });
      addImpact(mix, 0.14, 0.18, 120, 62, 0.22);
    }
  },
  {
    name: "hero-skill-attack",
    duration: 0.72,
    build(mix) {
      addSlash(mix, 0.02, 0.32, 1.0);
      addSlash(mix, 0.17, 0.28, 0.72);
      addFilteredNoise(mix, {
        start: 0.22,
        duration: 0.18,
        volume: 0.38,
        highpass: 620,
        lowpass: 3200,
        attack: 0.003,
        decay: 8,
        seed: 21,
        texture: "scrape"
      });
      addImpact(mix, 0.24, 0.2, 150, 70, 0.24);
    }
  },
  {
    name: "hero-finisher-attack",
    duration: 0.95,
    build(mix) {
      addSlash(mix, 0.03, 0.34, 1.05);
      addSlash(mix, 0.22, 0.34, 0.95);
      addFilteredNoise(mix, {
        start: 0.29,
        duration: 0.28,
        volume: 0.48,
        highpass: 450,
        lowpass: 3000,
        attack: 0.004,
        decay: 5.8,
        seed: 31,
        texture: "scrape"
      });
      addImpact(mix, 0.35, 0.32, 135, 42, 0.42);
      addFilteredNoise(mix, {
        start: 0.36,
        duration: 0.22,
        volume: 0.28,
        highpass: 120,
        lowpass: 1400,
        attack: 0.002,
        decay: 4.5,
        seed: 32,
        texture: "burst"
      });
    }
  },
  {
    name: "ally-fire-attack",
    duration: 0.88,
    build(mix) {
      addFilteredNoise(mix, {
        start: 0.02,
        duration: 0.68,
        volume: 0.62,
        highpass: 55,
        lowpass: 1150,
        attack: 0.08,
        decay: 1.6,
        seed: 41,
        texture: "flame"
      });
      addFilteredNoise(mix, {
        start: 0.12,
        duration: 0.46,
        volume: 0.32,
        highpass: 350,
        lowpass: 2200,
        attack: 0.03,
        decay: 2.4,
        seed: 42,
        texture: "crackle"
      });
      addRumble(mix, 0.04, 0.62, 54, 0.2);
    }
  },
  {
    name: "ally-earth-attack",
    duration: 0.95,
    build(mix) {
      addImpact(mix, 0.02, 0.46, 92, 32, 0.78);
      addFilteredNoise(mix, {
        start: 0.035,
        duration: 0.42,
        volume: 0.72,
        highpass: 45,
        lowpass: 1050,
        attack: 0.001,
        decay: 5.4,
        seed: 51,
        texture: "burst"
      });
      addFilteredNoise(mix, {
        start: 0.2,
        duration: 0.52,
        volume: 0.24,
        highpass: 180,
        lowpass: 1850,
        attack: 0.006,
        decay: 3.2,
        seed: 52,
        texture: "debris"
      });
    }
  },
  {
    name: "ally-wind-attack",
    duration: 0.78,
    build(mix) {
      addWindCut(mix, 0.03, 0.16, 0.54, 61);
      addWindCut(mix, 0.17, 0.15, 0.5, 62);
      addWindCut(mix, 0.31, 0.17, 0.58, 63);
      addFilteredNoise(mix, {
        start: 0.44,
        duration: 0.18,
        volume: 0.42,
        highpass: 950,
        lowpass: 4800,
        attack: 0.002,
        decay: 9.5,
        seed: 64,
        texture: "scrape"
      });
      addImpact(mix, 0.48, 0.14, 105, 60, 0.16);
    }
  },
  {
    name: "ally-water-attack",
    duration: 0.9,
    build(mix) {
      addFilteredNoise(mix, {
        start: 0.02,
        duration: 0.58,
        volume: 0.58,
        highpass: 90,
        lowpass: 1850,
        attack: 0.018,
        decay: 2.0,
        seed: 71,
        texture: "water"
      });
      addFilteredNoise(mix, {
        start: 0.09,
        duration: 0.38,
        volume: 0.36,
        highpass: 520,
        lowpass: 3000,
        attack: 0.008,
        decay: 2.8,
        seed: 72,
        texture: "spray"
      });
      addImpact(mix, 0.08, 0.26, 86, 44, 0.24);
      addRumble(mix, 0.18, 0.46, 68, 0.12);
    }
  },
  {
    // 精霊の帰還音：光に還るような、低→高へ上がっていく柔らかなシマー。
    name: "ally-return",
    duration: 0.7,
    build(mix) {
      addImpact(mix, 0.02, 0.34, 240, 760, 0.24); // 上昇トーン（低→高）
      addImpact(mix, 0.12, 0.3, 360, 990, 0.16);
      addFilteredNoise(mix, {
        start: 0.04,
        duration: 0.5,
        volume: 0.26,
        highpass: 620,
        lowpass: 5200,
        attack: 0.05,
        decay: 2.4,
        seed: 81,
        texture: "spray"
      });
      addRumble(mix, 0.0, 0.18, 180, 0.07);
    }
  }
];

for (const spec of sfx) {
  const mix = new Float32Array(Math.ceil((spec.duration + 0.05) * SAMPLE_RATE));
  spec.build(mix);
  await writeWav(join(OUT_DIR, `${spec.name}.wav`), finalize(mix, 0.9));
}

function addSlash(mix, start, duration, volume) {
  addFilteredNoise(mix, {
    start,
    duration,
    volume: volume * 0.46,
    highpass: 380,
    lowpass: 2400,
    attack: 0.006,
    decay: 5.8,
    seed: Math.floor(start * 1000) + 101,
    texture: "slash"
  });
  addFilteredNoise(mix, {
    start: start + duration * 0.32,
    duration: duration * 0.42,
    volume: volume * 0.34,
    highpass: 900,
    lowpass: 4300,
    attack: 0.002,
    decay: 9,
    seed: Math.floor(start * 1000) + 102,
    texture: "scrape"
  });
}

function addWindCut(mix, start, duration, volume, seed) {
  addFilteredNoise(mix, {
    start,
    duration,
    volume,
    highpass: 720,
    lowpass: 4100,
    attack: 0.004,
    decay: 7.8,
    seed,
    texture: "wind"
  });
}

function addFilteredNoise(mix, options) {
  const {
    start,
    duration,
    volume,
    highpass = 0,
    lowpass = 5000,
    attack = 0.01,
    decay = 3,
    seed: seedInput = 1,
    texture = "noise"
  } = options;
  let seed = seedInput >>> 0;
  let lpHigh = 0;
  let lpLow = 0;
  let previous = 0;
  const highAlpha = cutoffAlpha(lowpass);
  const lowAlpha = highpass > 0 ? cutoffAlpha(highpass) : 0;
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(mix.length, Math.floor((start + duration) * SAMPLE_RATE));

  for (let i = startSample; i < endSample; i += 1) {
    const t = i / SAMPLE_RATE - start;
    const p = Math.max(0, Math.min(1, t / duration));
    const white = randomSigned();
    const shaped = shapeNoise(white, previous, p, texture, seed);
    previous = white;

    lpHigh += (shaped - lpHigh) * highAlpha;
    let filtered = lpHigh;
    if (highpass > 0) {
      lpLow += (filtered - lpLow) * lowAlpha;
      filtered -= lpLow;
    }

    const gate = texture === "crackle" || texture === "debris"
      ? ((seed >>> 25) / 127 > (texture === "crackle" ? 0.62 : 0.72) ? 1 : 0.35)
      : 1;
    const env = Math.min(1, t / attack) * Math.exp(-p * decay);
    mix[i] += filtered * env * volume * gate;
  }

  function randomSigned() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  }
}

function shapeNoise(white, previous, p, texture, seed) {
  const harsh = white - previous * 0.62;
  if (texture === "slash") return harsh * (0.7 + p * 0.8) + white * 0.25;
  if (texture === "scrape") return harsh * 0.95 + Math.sign(white) * Math.abs(white) ** 0.45 * 0.2;
  if (texture === "flame") return white * 0.45 + Math.sin(p * Math.PI * 9 + (seed & 15)) * 0.18;
  if (texture === "crackle") return harsh * 0.55 + Math.sign(white) * 0.45;
  if (texture === "burst") return white * (1 - p * 0.3) + harsh * 0.22;
  if (texture === "debris") return harsh * 0.5 + (white > 0.65 ? 1 : white < -0.65 ? -1 : white * 0.25);
  if (texture === "wind") return harsh * 0.72 + Math.sin(p * Math.PI * 17) * 0.14;
  if (texture === "water") return white * 0.54 + Math.sin(p * Math.PI * 24) * 0.22;
  if (texture === "spray") return harsh * 0.42 + white * 0.62;
  return white;
}

function addImpact(mix, start, duration, startFreq, endFreq, volume) {
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(mix.length, Math.floor((start + duration) * SAMPLE_RATE));
  let phase = 0;
  for (let i = startSample; i < endSample; i += 1) {
    const t = i / SAMPLE_RATE - start;
    const p = Math.max(0, Math.min(1, t / duration));
    const freq = startFreq + (endFreq - startFreq) * p ** 0.72;
    phase += freq / SAMPLE_RATE;
    const env = Math.exp(-p * 6.6);
    const drive = Math.tanh(Math.sin(Math.PI * 2 * phase) * 2.4);
    mix[i] += drive * env * volume;
  }
}

function addRumble(mix, start, duration, freq, volume) {
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(mix.length, Math.floor((start + duration) * SAMPLE_RATE));
  for (let i = startSample; i < endSample; i += 1) {
    const t = i / SAMPLE_RATE - start;
    const p = Math.max(0, Math.min(1, t / duration));
    const env = Math.min(1, t / 0.05) * Math.exp(-p * 2.6);
    const wave = Math.sin(Math.PI * 2 * freq * t) + Math.sin(Math.PI * 2 * freq * 0.51 * t) * 0.45;
    mix[i] += wave * env * volume;
  }
}

function cutoffAlpha(freq) {
  return 1 - Math.exp((-2 * Math.PI * freq) / SAMPLE_RATE);
}

function finalize(mix, target) {
  fadeEnds(mix, 0.006);
  let peak = 0;
  for (const value of mix) peak = Math.max(peak, Math.abs(value));
  const gain = peak > 0 ? target / peak : 1;
  const out = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i += 1) {
    const soft = Math.tanh(mix[i] * gain * 1.12);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(soft * 32767)));
  }
  return out;
}

function fadeEnds(mix, seconds) {
  const samples = Math.min(mix.length, Math.floor(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples; i += 1) {
    const fade = i / samples;
    mix[i] *= fade;
    mix[mix.length - 1 - i] *= fade;
  }
}

async function writeWav(path, pcm) {
  await mkdir(dirname(path), { recursive: true });
  const header = Buffer.alloc(44);
  const dataSize = pcm.length * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  const data = Buffer.alloc(dataSize);
  for (let i = 0; i < pcm.length; i += 1) data.writeInt16LE(pcm[i], i * 2);
  await writeFile(path, Buffer.concat([header, data]));
  console.log(`Wrote ${path}`);
}
