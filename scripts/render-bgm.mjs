#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = join(ROOT, "public", "audio");
const SAMPLE_RATE = 44100;

await mkdir(OUT_DIR, { recursive: true });

await renderField(join(OUT_DIR, "field.wav"));
await renderAdventure(join(OUT_DIR, "adventure.wav"));
await renderBattle(join(OUT_DIR, "battle.wav"));
await renderDungeonAdventure(join(OUT_DIR, "dungeon-adventure.wav"));
await renderDungeonBattle(join(OUT_DIR, "dungeon-battle.wav"));
await renderCastleAdventure(join(OUT_DIR, "castle-adventure.wav"));
await renderCastleBattle(join(OUT_DIR, "castle-battle.wav"));

async function renderField(outPath) {
  const bpm = 122;
  const beat = 60 / bpm;
  const bars = 32;
  const length = bars * 4 * beat;
  const mix = new Float32Array(Math.ceil((length + 0.6) * SAMPLE_RATE));

  const chords = [
    chord("G3", "D4", "G4", "B4"),
    chord("D3", "A3", "D4", "F#4"),
    chord("E3", "B3", "E4", "G4"),
    chord("C3", "G3", "C4", "E4"),
    chord("A2", "E3", "A3", "C4"),
    chord("D3", "A3", "D4", "F#4"),
    chord("G3", "D4", "G4", "B4"),
    chord("D3", "A3", "D4", "A4")
  ];
  const roots = [43, 38, 40, 36, 33, 38, 43, 38];
  const melody = [
    "G5", "B5", "D6", "E6", "D6", "B5", "A5", "G5",
    "F#5", "A5", "D6", "E6", "D6", "A5", "B5", "A5",
    "G5", "B5", "E6", "F#6", "E6", "D6", "B5", "G5",
    "A5", "C6", "B5", "A5", "G5", "F#5", "G5", "D5"
  ].map(note);
  const counter = [
    "D4", null, "G4", null, "B4", null, "A4", null,
    "A3", null, "D4", null, "F#4", null, "G4", null
  ].map((value) => (value ? note(value) : null));

  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4 * beat;
    const currentChord = chords[bar % chords.length];
    const root = roots[bar % roots.length];

    currentChord.forEach((midi, index) => {
      addNote(mix, midi, start + index * 0.018, beat * 4.15, 0.05, "strings", -0.2 + index * 0.13);
      addNote(mix, midi + 12, start + index * 0.012, beat * 4, 0.022, "warm", 0.18 - index * 0.09);
    });

    if (bar % 4 === 0) {
      currentChord.forEach((midi, index) => addNote(mix, midi + 12, start + index * 0.016, beat * 1.9, 0.052, "brass", -0.15 + index * 0.1));
      addNoise(mix, start, 0.6, 0.04, "cymbal", 0);
    }

    for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
      const t = start + beatIndex * beat;
      addNote(mix, root, t, beat * 0.96, 0.095, "bass", -0.18);
      addNote(mix, root + 12, t + beat * 0.48, beat * 0.44, 0.045, "bass", -0.12);
      addNoise(mix, t + beat * 0.02, 0.16, beatIndex === 0 ? 0.05 : 0.022, "timpani", -0.12);
    }

    for (let step = 0; step < 8; step += 1) {
      const t = start + step * beat * 0.5;
      const arp = currentChord[[0, 2, 1, 3, 2, 1, 3, 2][step]] + 12;
      addNote(mix, arp, t + 0.012, beat * 0.34, 0.035, "harp", step % 2 ? 0.32 : -0.32);
    }
  }

  melody.forEach((midi, index) => {
    const t = index * beat * 0.5;
    addNote(mix, midi, t, beat * 0.68, 0.08, "lead", 0.06);
    addNote(mix, midi - 12, t + 0.012, beat * 0.58, 0.035, "horn", -0.06);
  });

  for (let index = 0; index < bars * 8; index += 1) {
    const midi = counter[index % counter.length];
    if (midi !== null) addNote(mix, midi, index * beat * 0.5 + 0.02, beat * 0.56, 0.038, "woodwind", -0.28);
  }

  await writeWav(outPath, finalize(mix, 0.92));
}

async function renderBattle(outPath) {
  const bpm = 178;
  const beat = 60 / bpm;
  const bars = 32;
  const length = bars * 4 * beat;
  const mix = new Float32Array(Math.ceil((length + 0.4) * SAMPLE_RATE));

  const chords = [
    chord("D2", "A2", "D3", "F3"),
    chord("Bb1", "F2", "Bb2", "D3"),
    chord("C2", "G2", "C3", "E3"),
    chord("A1", "E2", "A2", "C#3"),
    chord("D2", "A2", "D3", "F3"),
    chord("G1", "D2", "G2", "Bb2"),
    chord("A1", "E2", "A2", "C#3"),
    chord("D2", "A2", "D3", "A3")
  ];
  const lead = [
    "D4", "A4", "D5", "F5", "E5", "C#5", "A4", "F4",
    "D4", "F4", "A4", "C5", "Bb4", "G4", "E4", "C#4",
    "D4", "A4", "D5", "F5", "G5", "F5", "E5", "C#5",
    "Bb4", "D5", "F5", "A5", "G5", "F5", "D5", "Bb4",
    "C5", "E5", "G5", "Bb5", "A5", "G5", "E5", "C5",
    "A4", "C#5", "E5", "A5", "G5", "E5", "C#5", "A4",
    "D5", "F5", "A5", "D6", "C#6", "A5", "F5", "D5",
    "E5", "G5", "Bb5", "E6", "D6", "Bb5", "A5", "F5"
  ].map(note);

  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4 * beat;
    const currentChord = chords[bar % chords.length];
    const root = currentChord[0];

    currentChord.forEach((midi, index) => {
      addNote(mix, midi + 12, start + index * 0.01, beat * 1.65, 0.066, "brass", -0.25 + index * 0.16);
      addNote(mix, midi + 24, start + beat * 2 + index * 0.01, beat * 1.1, 0.042, "strings", 0.22 - index * 0.12);
    });

    if (bar % 4 === 0) {
      addNoise(mix, start, 0.9, 0.095, "cymbal", 0);
      addNote(mix, root + 36, start + beat * 0.04, beat * 0.8, 0.09, "brassLead", -0.05);
      addNote(mix, root + 43, start + beat * 0.52, beat * 0.8, 0.078, "brassLead", 0.05);
    }

    for (let step = 0; step < 16; step += 1) {
      const t = start + step * beat * 0.25;
      const degree = [0, 0, 2, 1, 0, 3, 2, 1, 0, 0, 2, 1, 3, 2, 1, 0][step];
      addNote(mix, currentChord[degree] + 24, t, beat * 0.18, 0.041, "staccato", step % 2 ? 0.34 : -0.34);
    }

    for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
      const t = start + beatIndex * beat;
      addNote(mix, root, t, beat * 0.9, 0.17, "bass", -0.12);
      addNote(mix, root + 12, t + beat * 0.5, beat * 0.38, 0.09, "bass", -0.08);
      addNoise(mix, t, 0.1, beatIndex === 0 ? 0.155 : 0.092, "kick", -0.08);
      addNoise(mix, t + beat * 0.5, 0.075, 0.066, "snare", 0.08);
    }

    for (let eighth = 0; eighth < 8; eighth += 1) {
      addNoise(mix, start + eighth * beat * 0.5, 0.045, 0.038, "hat", eighth % 2 ? 0.22 : -0.22);
    }
  }

  for (let index = 0; index < bars * 8; index += 1) {
    const midi = lead[index % lead.length];
    const t = index * beat * 0.5;
    addNote(mix, midi, t, beat * 0.42, 0.118, "brassLead", 0.02);
    addNote(mix, midi - 12, t + 0.008, beat * 0.36, 0.056, "horn", -0.12);
  }

  await writeWav(outPath, finalize(mix, 0.94));
}

async function renderAdventure(outPath) {
  const bpm = 132;
  const beat = 60 / bpm;
  const bars = 48;
  const length = bars * 4 * beat;
  const mix = new Float32Array(Math.ceil((length + 0.9) * SAMPLE_RATE));

  const chords = [
    chord("D3", "A3", "D4", "F#4", "A4"),
    chord("A2", "E3", "A3", "C#4", "E4"),
    chord("B2", "F#3", "B3", "D4", "F#4"),
    chord("G2", "D3", "G3", "B3", "D4"),
    chord("E2", "B2", "E3", "G3", "B3"),
    chord("A2", "E3", "A3", "C#4", "E4"),
    chord("D3", "A3", "D4", "F#4", "A4"),
    chord("A2", "E3", "A3", "E4", "A4"),
    chord("G2", "D3", "G3", "B3", "D4"),
    chord("A2", "E3", "A3", "C#4", "E4"),
    chord("F#2", "C#3", "F#3", "A3", "C#4"),
    chord("B2", "F#3", "B3", "D4", "F#4"),
    chord("E2", "B2", "E3", "G3", "B3"),
    chord("F#2", "C#3", "F#3", "A3", "C#4"),
    chord("G2", "D3", "G3", "B3", "D4"),
    chord("A2", "E3", "A3", "C#4", "E4")
  ];
  const roots = chords.map((currentChord) => currentChord[0]);
  const melody = [
    ["D5", 1.35, 1.18], null, ["A5", 0.76, 1], ["B5", 0.76, 1],
    ["C#6", 1.08, 1.08], ["B5", 0.74, 1], ["A5", 1.28, 1.05], null,
    ["F#5", 1.2, 1.06], null, ["A5", 0.76, 1], ["C#6", 0.76, 1],
    ["E6", 1.08, 1.12], ["D6", 0.74, 1], ["C#6", 1.28, 1.02], null,
    ["B5", 1.18, 1.05], null, ["D6", 0.76, 1], ["F#6", 0.76, 1],
    ["E6", 1.08, 1.08], ["D6", 0.74, 1], ["B5", 1.28, 1], null,
    ["G5", 1.16, 1.04], null, ["B5", 0.76, 1], ["D6", 0.76, 1],
    ["C#6", 1.08, 1.04], ["A5", 0.74, 1], ["F#5", 1.28, 1], null,
    ["E5", 1.18, 1.02], null, ["G5", 0.76, 1], ["B5", 0.76, 1],
    ["D6", 1.08, 1.08], ["C#6", 0.74, 1], ["B5", 1.24, 1], null,
    ["A5", 1.22, 1.08], null, ["C#6", 0.76, 1], ["E6", 0.76, 1],
    ["F#6", 1.12, 1.16], ["E6", 0.74, 1], ["D6", 1.28, 1.08], null,
    ["F#5", 1.12, 1], ["A5", 0.74, 1], ["D6", 0.74, 1], ["F#6", 0.74, 1],
    ["A6", 1.28, 1.18], null, ["F#6", 0.74, 1], ["E6", 0.74, 1],
    ["D6", 1.18, 1.08], ["C#6", 0.74, 1], ["B5", 0.74, 1], ["A5", 0.74, 1],
    ["G5", 1.0, 1], ["F#5", 0.74, 1], ["E5", 0.74, 1], ["C#5", 0.74, 1],
    ["D5", 1.7, 1.22], null, null, null
  ].map((event) => (event ? { midi: note(event[0]), length: event[1], accent: event[2] } : null));
  const hornAnswer = [
    "A4", null, "D5", null, "F#5", null, "E5", null,
    "E4", null, "A4", null, "C#5", null, "B4", null,
    "F#4", null, "B4", null, "D5", null, "C#5", null,
    "D4", null, "G4", null, "B4", null, "A4", null
  ].map((value) => (value ? note(value) : null));

  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4 * beat;
    const currentChord = chords[bar % chords.length];
    const root = roots[bar % roots.length];

    currentChord.forEach((midi, index) => {
      addNote(mix, midi, start + index * 0.014, beat * 4.25, 0.072, "strings", -0.28 + index * 0.12);
      addNote(mix, midi + 12, start + index * 0.012, beat * 4.0, 0.04, "warm", 0.24 - index * 0.1);
      if (index > 1) addNote(mix, midi + 19, start + beat * 0.04 + index * 0.016, beat * 3.85, 0.024, "woodwind", 0.18 - index * 0.07);
    });

    if (bar % 4 === 0) {
      currentChord.slice(1).forEach((midi, index) => addNote(mix, midi + 12, start + beat * 0.04 + index * 0.018, beat * 2.35, 0.102, "brass", -0.18 + index * 0.14));
      addNote(mix, root + 24, start + beat * 0.02, beat * 0.62, 0.09, "brassLead", -0.08);
      addNote(mix, root + 31, start + beat * 0.52, beat * 0.62, 0.078, "brassLead", 0.02);
      addNote(mix, root + 36, start + beat * 1.02, beat * 1.3, 0.094, "brassLead", 0.08);
    } else if (bar % 4 === 2) {
      currentChord.slice(0, 4).forEach((midi, index) => addNote(mix, midi + 12, start + beat * 2.02 + index * 0.018, beat * 1.7, 0.082, "brass", 0.18 - index * 0.12));
    }

    if (bar % 8 === 0) addNoise(mix, start, 1.05, 0.098, "cymbal", 0);
    else if (bar % 4 === 0) addNoise(mix, start, 0.72, 0.064, "cymbal", 0);

    for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
      const t = start + beatIndex * beat;
      addNote(mix, root, t, beat * 1.16, 0.168, "bass", -0.14);
      addNote(mix, root + 12, t + beat * 0.5, beat * 0.46, 0.078, "bass", -0.08);
      addNote(mix, root + 19, t + beat * 0.76, beat * 0.32, 0.05, "bass", -0.06);
      if (beatIndex === 0 || beatIndex === 2) addNoise(mix, t + 0.02, 0.22, 0.104, "timpani", -0.08);
      if (beatIndex === 1 || beatIndex === 3) addNoise(mix, t + beat * 0.03, 0.08, 0.036, "snare", 0.06);
    }

    for (let step = 0; step < 16; step += 1) {
      const t = start + step * beat * 0.25;
      const degree = [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 2, 3, 2, 1, 2][step];
      addNote(mix, currentChord[degree] + 12, t + 0.008, beat * 0.18, 0.032, "staccato", step % 2 ? 0.34 : -0.34);
    }

    for (let step = 0; step < 12; step += 1) {
      const t = start + step * beat / 3;
      const degree = [0, 2, 4, 3, 2, 1, 0, 2, 4, 2, 1, 3][step];
      addNote(mix, currentChord[degree] + 24, t + 0.012, beat * 0.22, 0.028, "harp", step % 2 ? 0.32 : -0.32);
    }
  }

  melody.forEach((event, index) => {
    if (!event) return;
    const t = index * beat * 0.5;
    const phraseLift = Math.floor(index / melody.length) % 2 === 1 ? 0.012 : 0;
    addNote(mix, event.midi, t, beat * event.length, (0.136 + phraseLift) * event.accent, "brassLead", 0.04);
    addNote(mix, event.midi - 12, t + 0.014, beat * Math.min(event.length, 1.4), 0.074, "horn", -0.16);
    addNote(mix, event.midi + 12, t + 0.02, beat * Math.min(event.length, 0.72), 0.044, "lead", 0.18);
    if (event.accent > 1.12) addNote(mix, event.midi + 7, t + 0.024, beat * 0.62, 0.046, "brass", 0.12);
  });

  for (let index = 0; index < bars * 8; index += 1) {
    const midi = hornAnswer[index % hornAnswer.length];
    if (midi !== null) {
      addNote(mix, midi, index * beat * 0.5 + beat * 0.08, beat * 0.62, 0.052, "woodwind", -0.3);
      addNote(mix, midi + 7, index * beat * 0.5 + beat * 0.08, beat * 0.56, 0.032, "horn", 0.25);
    }
  }

  await writeWav(outPath, finalize(mix, 0.96));
}

async function renderDungeonAdventure(outPath) {
  const bpm = 92;
  const beat = 60 / bpm;
  const bars = 32;
  const length = bars * 4 * beat;
  const mix = new Float32Array(Math.ceil((length + 1.1) * SAMPLE_RATE));
  const chords = [
    chord("D2", "A2", "Eb3", "F3"),
    chord("D2", "Ab2", "C3", "F3"),
    chord("Bb1", "F2", "C3", "Eb3"),
    chord("C2", "G2", "Db3", "E3"),
    chord("D2", "A2", "Eb3", "G3"),
    chord("F1", "C2", "Ab2", "Eb3"),
    chord("Eb2", "Bb2", "Db3", "G3"),
    chord("A1", "E2", "Bb2", "C#3")
  ];
  const whispers = ["D4", null, "Eb4", null, "F4", "E4", null, "C4", "D4", null, "A3", null, "Bb3", null, "Ab3", null]
    .map((value) => (value ? note(value) : null));

  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4 * beat;
    const currentChord = chords[bar % chords.length];
    const root = currentChord[0];
    currentChord.forEach((midi, index) => {
      addNote(mix, midi, start + index * 0.03, beat * 4.5, 0.108, "warm", -0.24 + index * 0.14);
      addNote(mix, midi + 12, start + beat * 0.08 + index * 0.02, beat * 3.8, 0.06, "strings", 0.18 - index * 0.12);
    });
    addNote(mix, root - 12, start, beat * 4.2, 0.22, "bass", -0.05);
    addNote(mix, root, start + beat * 2, beat * 1.8, 0.092, "bass", 0.05);
    if (bar % 2 === 0) addNoise(mix, start + beat * 0.2, 1.6, 0.062, "cymbal", 0);
    if (bar % 4 === 3) addNote(mix, root + 25, start + beat * 2.5, beat * 1.2, 0.082, "horn", 0.08);
    for (let step = 0; step < 8; step += 1) {
      const t = start + step * beat * 0.5;
      const midi = whispers[(bar * 3 + step) % whispers.length];
      if (midi !== null) addNote(mix, midi, t + 0.04, beat * 0.7, 0.055, "woodwind", step % 2 ? 0.28 : -0.28);
      if (step % 2 === 0) addNote(mix, currentChord[step % currentChord.length] + 24, t + 0.02, beat * 0.22, 0.024, "staccato", step % 4 ? 0.18 : -0.18);
    }
    for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
      addNoise(mix, start + beatIndex * beat + beat * 0.02, 0.28, beatIndex === 0 ? 0.09 : 0.04, "timpani", -0.08);
    }
  }

  await writeWav(outPath, finalize(mix, 0.97));
}

async function renderDungeonBattle(outPath) {
  const bpm = 166;
  const beat = 60 / bpm;
  const bars = 32;
  const length = bars * 4 * beat;
  const mix = new Float32Array(Math.ceil((length + 0.7) * SAMPLE_RATE));
  const chords = [
    chord("D2", "A2", "Eb3", "F3"),
    chord("D2", "A2", "C3", "F3"),
    chord("Bb1", "F2", "Bb2", "Db3"),
    chord("C2", "G2", "Db3", "E3"),
    chord("D2", "A2", "Eb3", "A3"),
    chord("F1", "C2", "Ab2", "C3"),
    chord("Eb2", "Bb2", "Db3", "G3"),
    chord("A1", "E2", "Bb2", "C#3")
  ];
  const lead = ["D4", "F4", "Eb4", "A4", "D5", "C5", "A4", "F4", "Eb4", "G4", "Bb4", "A4", "F4", "Eb4", "C#4", "A3"]
    .map(note);

  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4 * beat;
    const currentChord = chords[bar % chords.length];
    const root = currentChord[0];
    currentChord.forEach((midi, index) => {
      addNote(mix, midi + 12, start + index * 0.012, beat * 1.15, 0.07, "brass", -0.24 + index * 0.16);
      addNote(mix, midi + 24, start + beat * 2 + index * 0.01, beat * 0.8, 0.04, "strings", 0.22 - index * 0.12);
    });
    for (let step = 0; step < 16; step += 1) {
      const t = start + step * beat * 0.25;
      const degree = [0, 0, 2, 1, 0, 3, 1, 2, 0, 0, 2, 3, 1, 2, 3, 0][step];
      addNote(mix, currentChord[degree] + 24, t, beat * 0.16, 0.045, "staccato", step % 2 ? 0.32 : -0.32);
    }
    for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
      const t = start + beatIndex * beat;
      addNote(mix, root, t, beat * 0.86, 0.18, "bass", -0.1);
      addNote(mix, root + 12, t + beat * 0.5, beat * 0.32, 0.09, "bass", -0.08);
      addNoise(mix, t, 0.11, beatIndex === 0 ? 0.16 : 0.1, "kick", -0.08);
      addNoise(mix, t + beat * 0.5, 0.08, 0.078, "snare", 0.08);
    }
    for (let eighth = 0; eighth < 8; eighth += 1) {
      addNoise(mix, start + eighth * beat * 0.5, 0.048, 0.04, "hat", eighth % 2 ? 0.24 : -0.24);
    }
    if (bar % 4 === 0) {
      addNoise(mix, start, 0.95, 0.09, "cymbal", 0);
      addNote(mix, root + 36, start + beat * 0.03, beat * 0.7, 0.09, "brassLead", -0.04);
      addNote(mix, root + 37, start + beat * 0.52, beat * 0.72, 0.076, "brassLead", 0.04);
    }
  }
  for (let index = 0; index < bars * 8; index += 1) {
    const midi = lead[index % lead.length];
    const t = index * beat * 0.5;
    addNote(mix, midi, t, beat * 0.38, 0.112, "brassLead", 0.03);
    addNote(mix, midi - 12, t + 0.01, beat * 0.34, 0.06, "horn", -0.15);
  }

  await writeWav(outPath, finalize(mix, 0.94));
}

async function renderCastleAdventure(outPath) {
  const bpm = 96;
  const beat = 60 / bpm;
  const bars = 32;
  const length = bars * 4 * beat;
  const mix = new Float32Array(Math.ceil((length + 0.9) * SAMPLE_RATE));
  const chords = [
    chord("D2", "A2", "D3", "F3", "A3"),
    chord("Bb1", "F2", "Bb2", "D3", "F3"),
    chord("G1", "D2", "G2", "Bb2", "D3"),
    chord("A1", "E2", "Bb2", "C#3", "E3"),
    chord("D2", "A2", "D3", "F3", "C4"),
    chord("C2", "G2", "C3", "Eb3", "G3"),
    chord("Bb1", "F2", "Bb2", "D3", "Ab3"),
    chord("A1", "E2", "A2", "C#3", "G3")
  ];
  const hymn = ["D4", "F4", "A4", "C5", "Bb4", "A4", "F4", "E4", "D4", "Eb4", "G4", "Bb4", "A4", "G4", "E4", "C#4"]
    .map(note);

  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4 * beat;
    const currentChord = chords[bar % chords.length];
    const root = currentChord[0];
    currentChord.forEach((midi, index) => {
      addNote(mix, midi, start + index * 0.018, beat * 4.45, 0.088, "strings", -0.28 + index * 0.12);
      addNote(mix, midi + 12, start + index * 0.014, beat * 4.1, 0.052, "warm", 0.24 - index * 0.1);
    });
    if (bar % 4 === 0) {
      currentChord.slice(1).forEach((midi, index) => addNote(mix, midi + 12, start + beat * 0.04 + index * 0.018, beat * 2.55, 0.112, "brass", -0.18 + index * 0.14));
      addNote(mix, root + 36, start + beat * 0.05, beat * 1.6, 0.07, "horn", 0.02);
      addNoise(mix, start, 0.9, 0.078, "cymbal", 0);
    } else if (bar % 4 === 2) {
      currentChord.slice(0, 4).forEach((midi, index) => addNote(mix, midi + 12, start + beat * 2.02 + index * 0.018, beat * 1.7, 0.072, "brass", 0.16 - index * 0.1));
    }
    for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
      const t = start + beatIndex * beat;
      addNote(mix, root - 12, t, beat * 1.18, 0.17, "bass", -0.12);
      addNote(mix, root, t + beat * 0.5, beat * 0.42, 0.066, "bass", -0.08);
      if (beatIndex === 0 || beatIndex === 2) addNoise(mix, t + 0.02, 0.3, 0.096, "timpani", -0.08);
    }
    for (let step = 0; step < 8; step += 1) {
      const t = start + step * beat * 0.5;
      const degree = [0, 2, 4, 2, 1, 3, 4, 3][step];
      addNote(mix, currentChord[degree] + 12, t + 0.014, beat * 0.32, 0.028, "staccato", step % 2 ? 0.26 : -0.26);
      if (step % 4 === 2) addNote(mix, currentChord[degree] + 13, t + 0.02, beat * 0.36, 0.026, "woodwind", step % 2 ? 0.2 : -0.2);
    }
  }
  for (let index = 0; index < bars * 4; index += 1) {
    const midi = hymn[index % hymn.length];
    const t = index * beat;
    addNote(mix, midi, t, beat * 0.92, 0.082, "horn", 0.02);
    addNote(mix, midi - 12, t + 0.012, beat * 0.82, 0.056, "brass", -0.15);
  }

  await writeWav(outPath, finalize(mix, 0.94));
}

async function renderCastleBattle(outPath) {
  const bpm = 156;
  const beat = 60 / bpm;
  const bars = 40;
  const length = bars * 4 * beat;
  const mix = new Float32Array(Math.ceil((length + 0.9) * SAMPLE_RATE));
  const chords = [
    chord("D2", "A2", "D3", "F3", "A3"),
    chord("Bb1", "F2", "Bb2", "D3", "F3"),
    chord("G1", "D2", "G2", "Bb2", "D3"),
    chord("A1", "E2", "A2", "C#3", "G3"),
    chord("F1", "C2", "F2", "A2", "C3"),
    chord("C2", "G2", "C3", "Eb3", "G3"),
    chord("Bb1", "F2", "Bb2", "D3", "Ab3"),
    chord("A1", "E2", "Bb2", "C#3", "E3")
  ];
  const lead = [
    "D4", "F4", "A4", "D5", "C5", "A4", "F4", "E4",
    "D4", "F4", "Bb4", "D5", "C5", "Bb4", "A4", "G4",
    "F4", "A4", "C5", "F5", "E5", "C5", "A4", "G4",
    "A4", "C#5", "E5", "A5", "G5", "E5", "C#5", "A4"
  ].map(note);
  const finale = [
    "D5", "F5", "A5", "C6", "D6", "C6", "A5", "F5",
    "Bb4", "D5", "F5", "A5", "Bb5", "A5", "F5", "D5",
    "C5", "Eb5", "G5", "Bb5", "C6", "Bb5", "G5", "Eb5",
    "A4", "C#5", "E5", "G5", "A5", "G5", "E5", "C#5"
  ]
    .map(note);

  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * 4 * beat;
    const currentChord = chords[bar % chords.length];
    const root = currentChord[0];
    currentChord.forEach((midi, index) => {
      addNote(mix, midi + 12, start + index * 0.012, beat * 2.05, 0.092, "brass", -0.25 + index * 0.16);
      addNote(mix, midi + 24, start + beat * 2 + index * 0.012, beat * 1.45, 0.05, "strings", 0.22 - index * 0.12);
      if (index > 1) addNote(mix, midi + 31, start + beat * 0.04 + index * 0.012, beat * 3.6, 0.022, "warm", 0.16 - index * 0.06);
    });

    if (bar % 8 === 0) {
      addNoise(mix, start, 1.1, 0.118, "cymbal", 0);
      addNote(mix, root + 36, start + beat * 0.04, beat * 1.2, 0.116, "brassLead", -0.05);
      addNote(mix, root + 43, start + beat * 0.82, beat * 1.0, 0.094, "brassLead", 0.05);
      addNote(mix, root + 48, start + beat * 1.56, beat * 1.35, 0.082, "horn", 0.02);
    } else if (bar % 4 === 0) {
      addNoise(mix, start, 0.72, 0.08, "cymbal", 0);
      addNote(mix, root + 36, start + beat * 0.04, beat * 0.92, 0.092, "brassLead", -0.05);
      addNote(mix, root + 42, start + beat * 0.72, beat * 0.82, 0.074, "brassLead", 0.05);
    }

    for (let step = 0; step < 12; step += 1) {
      const t = start + step * beat / 3;
      const degree = [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 3, 1][step];
      addNote(mix, currentChord[degree] + 24, t, beat * 0.18, 0.034, "staccato", step % 2 ? 0.32 : -0.32);
      if (step % 3 === 1) addNote(mix, currentChord[degree] + 13, t + 0.012, beat * 0.22, 0.028, "horn", step % 2 ? 0.16 : -0.16);
    }

    for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
      const t = start + beatIndex * beat;
      addNote(mix, root - 12, t, beat * 1.05, 0.205, "bass", -0.12);
      addNote(mix, root, t + beat * 0.5, beat * 0.42, 0.098, "bass", -0.08);
      addNoise(mix, t, 0.12, beatIndex === 0 ? 0.17 : 0.082, "kick", -0.08);
      if (beatIndex === 1 || beatIndex === 3) addNoise(mix, t + beat * 0.02, 0.09, 0.066, "snare", 0.08);
      if (beatIndex === 0 || beatIndex === 2) addNoise(mix, t + beat * 0.03, 0.24, 0.078, "timpani", -0.04);
    }

    for (let eighth = 0; eighth < 8; eighth += 1) {
      addNoise(mix, start + eighth * beat * 0.5, 0.044, 0.03, "hat", eighth % 2 ? 0.22 : -0.22);
    }
  }

  for (let index = 0; index < bars * 8; index += 1) {
    const phrase = Math.floor(index / 32) % 2 === 1 ? finale : lead;
    const midi = phrase[index % phrase.length];
    const t = index * beat * 0.5;
    const lift = Math.floor(index / 64) * 0.006;
    addNote(mix, midi, t, beat * 0.56, 0.112 + lift, "brassLead", 0.02);
    addNote(mix, midi - 12, t + 0.01, beat * 0.46, 0.074, "horn", -0.12);
    if (index % 8 === 6) addNote(mix, midi + 7, t + 0.018, beat * 0.42, 0.038, "brass", 0.12);
  }

  await writeWav(outPath, finalize(mix, 0.95));
}

function addNote(mix, midi, start, duration, volume, instrument, pan = 0) {
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(mix.length, Math.floor((start + duration) * SAMPLE_RATE));
  const freq = 440 * 2 ** ((midi - 69) / 12);
  for (let i = startSample; i < endSample; i += 1) {
    const t = i / SAMPLE_RATE - start;
    const phase = t * freq;
    const env = envelope(t, duration, instrument);
    const wave = waveform(phase, instrument);
    mix[i] += wave * env * volume * (1 - Math.abs(pan) * 0.12);
  }
}

function addNoise(mix, start, duration, volume, kind) {
  let seed = Math.floor(start * 100000) + 17;
  const startSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endSample = Math.min(mix.length, Math.floor((start + duration) * SAMPLE_RATE));
  for (let i = startSample; i < endSample; i += 1) {
    const t = i / SAMPLE_RATE - start;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    let noise = (seed / 0xffffffff) * 2 - 1;
    if (kind === "kick" || kind === "timpani") {
      const pitch = kind === "kick" ? 68 - t * 110 : 92 - t * 70;
      noise = Math.sin(Math.PI * 2 * pitch * t) * 0.75 + noise * 0.25;
    }
    if (kind === "hat" || kind === "cymbal") noise *= Math.sin(Math.PI * 2 * 7300 * t);
    mix[i] += noise * volume * Math.exp(-t * (kind === "cymbal" ? 4 : 18));
  }
}

function waveform(phase, instrument) {
  const p = phase % 1;
  if (instrument === "bass") return Math.sin(Math.PI * 2 * phase) * 0.7 + Math.sin(Math.PI * 4 * phase) * 0.25;
  if (instrument === "brass" || instrument === "brassLead") return saw(p) * 0.62 + square(p) * 0.22 + Math.sin(Math.PI * 2 * phase) * 0.16;
  if (instrument === "strings") return saw(p) * 0.35 + saw((phase * 1.006) % 1) * 0.35 + Math.sin(Math.PI * 2 * phase) * 0.22;
  if (instrument === "harp" || instrument === "staccato") return triangle(p) * 0.72 + Math.sin(Math.PI * 4 * phase) * 0.18;
  if (instrument === "woodwind" || instrument === "horn") return triangle(p) * 0.56 + Math.sin(Math.PI * 2 * phase) * 0.38;
  if (instrument === "warm") return Math.sin(Math.PI * 2 * phase) * 0.82 + triangle(p) * 0.18;
  return square(p) * 0.54 + triangle(p) * 0.3 + Math.sin(Math.PI * 2 * phase) * 0.16;
}

function envelope(t, duration, instrument) {
  const attack = instrument === "strings" || instrument === "warm" ? 0.12 : instrument === "brass" ? 0.045 : 0.008;
  const release = instrument === "strings" || instrument === "warm" ? 0.22 : instrument === "harp" || instrument === "staccato" ? 0.08 : 0.12;
  const a = Math.min(1, t / attack);
  const r = Math.min(1, (duration - t) / release);
  if (instrument === "harp" || instrument === "staccato") return a * r * Math.exp(-t * 3.8);
  return Math.max(0, Math.min(a, r));
}

function saw(p) {
  return p * 2 - 1;
}

function square(p) {
  return p < 0.5 ? 1 : -1;
}

function triangle(p) {
  return 1 - Math.abs(p * 4 - 2);
}

function finalize(mix, target) {
  let peak = 0;
  for (const value of mix) peak = Math.max(peak, Math.abs(value));
  const gain = peak > 0 ? target / peak : 1;
  const out = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i += 1) {
    const soft = Math.tanh(mix[i] * gain * 1.15);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(soft * 32767)));
  }
  return out;
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

function chord(...names) {
  return names.map(note);
}

function note(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Invalid note: ${name}`);
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]] + accidental;
  return (Number(match[3]) + 1) * 12 + semitone;
}
