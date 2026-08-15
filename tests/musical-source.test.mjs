import assert from "node:assert/strict";
import test from "node:test";
import {
  PITCHED_GENERATOR_TYPES,
  createPitchInstruction,
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

test("M13 exposes exactly Sine, Triangle, and Saw oscillator generators", () => {
  assert.deepEqual(PITCHED_GENERATOR_TYPES, ["sine", "triangle", "saw"]);
  assert.deepEqual(PITCHED_GENERATOR_TYPES.map(generatorLabel), ["Sine", "Triangle", "Saw"]);
  assert.deepEqual(PITCHED_GENERATOR_TYPES.map(oscillatorTypeForGenerator), ["sine", "triangle", "sawtooth"]);
  assert.equal(normalizePitchedGeneratorType("square"), "sine");
});
