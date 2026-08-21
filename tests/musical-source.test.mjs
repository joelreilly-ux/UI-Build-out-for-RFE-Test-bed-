import assert from "node:assert/strict";
import test from "node:test";
import {
  PITCHED_GENERATOR_TYPES,
  ARPEGGIO_PITCH_MAX,
  ARPEGGIO_RATE_MAX_MS,
  ARPEGGIO_RATE_MIN_MS,
  createArpeggioInstruction,
  createPitchInstruction,
  getArpeggioIntervals,
  getArpeggioPitch,
  generatorLabel,
  normalizePitchedGeneratorType,
  oscillatorTypeForGenerator,
} from "../app/musical-source.ts";

test("pitch instructions are finite, bounded, immutable, and generator-independent", () => {
  const instruction = createPitchInstruction(440.4);
  assert.deepEqual(instruction, { frequencyHz: 440 });
  assert.equal(Object.isFrozen(instruction), true);
  assert.equal(createPitchInstruction(Number.NaN, 220).frequencyHz, 220);
  assert.equal(createPitchInstruction(Number.POSITIVE_INFINITY, Number.NaN).frequencyHz, 78);
  assert.equal(createPitchInstruction(-1).frequencyHz, 50);
  assert.equal(createPitchInstruction(99_999).frequencyHz, 10_000);
});

test("M14 retains Sine, Triangle, and Saw and adds Square through the pitched-generator contract", () => {
  assert.deepEqual(PITCHED_GENERATOR_TYPES, ["sine", "triangle", "saw", "square"]);
  assert.deepEqual(PITCHED_GENERATOR_TYPES.map(generatorLabel), ["Sine", "Triangle", "Saw", "Square"]);
  assert.deepEqual(PITCHED_GENERATOR_TYPES.map(oscillatorTypeForGenerator), ["sine", "triangle", "sawtooth", "square"]);
  assert.equal(normalizePitchedGeneratorType("pulse"), "sine");
});

test("Arpeggio deterministically traverses and transposes bounded pitch patterns", () => {
  const arpeggio = createArpeggioInstruction({ enabled: true, pattern: "major", pitchCount: 4, direction: "up", rateMs: 700 });
  assert.deepEqual(getArpeggioIntervals(arpeggio), [0, 4, 7, 12]);
  assert.deepEqual([0, 1, 2, 3].map((step) => getArpeggioPitch(createPitchInstruction(220), arpeggio, step).frequencyHz), [220, 277, 330, 440]);
  assert.deepEqual([0, 1, 2, 3].map((step) => getArpeggioPitch(createPitchInstruction(440), arpeggio, step).frequencyHz), [440, 554, 659, 880]);
  assert.deepEqual(getArpeggioIntervals(createArpeggioInstruction({ enabled: true, pattern: "minor", pitchCount: 4, direction: "down" })), [12, 7, 3, 0]);
  assert.deepEqual(getArpeggioIntervals(createArpeggioInstruction({ enabled: true, pattern: "major", pitchCount: 4, direction: "up-down" })), [0, 4, 7, 12, 7, 4]);
});

test("Arpeggio bounds pitch count and rate while retaining one sequential pitch", () => {
  const bounded = createArpeggioInstruction({ enabled: true, pitchCount: 99, rateMs: 99_999 });
  assert.equal(bounded.pitchCount, ARPEGGIO_PITCH_MAX);
  assert.equal(bounded.rateMs, ARPEGGIO_RATE_MAX_MS);
  assert.equal(createArpeggioInstruction({ rateMs: 1 }).rateMs, ARPEGGIO_RATE_MIN_MS);
  assert.equal(getArpeggioPitch(createPitchInstruction(220), createArpeggioInstruction({ enabled: false }), 5).frequencyHz, 220);
});
